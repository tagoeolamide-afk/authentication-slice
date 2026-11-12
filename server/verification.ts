import type { Request, Response } from "express";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { isUniqueViolation, prisma } from "./db";
import { sendInBackground, verificationCodeEmail } from "./mailer";

const V = config.verification;

// ---------------------------------------------------------------- Codes

function hmac(value: string): string {
  return createHmac("sha256", config.authSecret).update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * A 6-digit code has only a million values, so a plain hash could be brute-forced from a
 * database copy. Keying it with AUTH_SECRET and the user id prevents that.
 */
const hashCode = (userId: string, code: string) => hmac(`verify:${userId}:${code}`);

/** Fresh code plus the row data to store for it. */
export function newCode(userId: string, now = new Date()) {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  return {
    code,
    data: { codeHash: hashCode(userId, code), expiresAt: new Date(now.getTime() + V.codeTtlMs), attempts: 0, lastSentAt: now },
  };
}

export function emailCode(user: { email: string; name: string }, code: string) {
  sendInBackground(verificationCodeEmail(user.email, user.name, code, V.codeTtlMs / 60_000));
}

/**
 * Sends a new code only if the cooldown has passed. The check and the replacement are one
 * conditional UPDATE, so two simultaneous requests can't both send.
 */
export async function issueCode(user: { id: string; email: string; name: string }) {
  const now = new Date();
  const { code, data } = newCode(user.id, now);
  const cutoff = new Date(now.getTime() - V.resendCooldownMs);

  const updated = await prisma.emailVerificationCode.updateMany({
    where: { userId: user.id, lastSentAt: { lte: cutoff } },
    data,
  });
  if (updated.count === 1) {
    emailCode(user, code);
    return { sent: true as const };
  }

  const existing = await prisma.emailVerificationCode.findUnique({ where: { userId: user.id } });
  if (existing) {
    const waitMs = existing.lastSentAt.getTime() + V.resendCooldownMs - now.getTime();
    return { sent: false as const, retryAfterSec: Math.max(1, Math.ceil(waitMs / 1000)) };
  }

  try {
    await prisma.emailVerificationCode.create({ data: { userId: user.id, ...data } });
    emailCode(user, code);
    return { sent: true as const };
  } catch (error) {
    if (isUniqueViolation(error)) return { sent: false as const, retryAfterSec: V.resendCooldownMs / 1000 };
    throw error;
  }
}

export type CheckResult =
  | { type: "ok"; userId: string }
  | { type: "invalid"; attemptsLeft?: number }
  | { type: "expired" }
  | { type: "too_many_attempts" };

export async function checkCode(email: string, code: string): Promise<CheckResult> {
  const user = await prisma.user.findUnique({ where: { email }, include: { verificationCode: true } });
  const row = user?.verificationCode;
  if (!user || user.emailVerifiedAt || !row) return { type: "invalid" };

  const now = new Date();
  if (row.expiresAt <= now) return { type: "expired" };

  // Count the attempt atomically before comparing, so parallel guesses can't exceed the cap.
  const counted = await prisma.emailVerificationCode.updateMany({
    where: { id: row.id, attempts: { lt: V.maxAttempts }, expiresAt: { gt: now } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count === 0) return { type: "too_many_attempts" };

  if (!safeEqual(row.codeHash, hashCode(user.id, code))) {
    const attemptsLeft = V.maxAttempts - (row.attempts + 1);
    return attemptsLeft <= 0 ? { type: "too_many_attempts" } : { type: "invalid", attemptsLeft };
  }

  // Deleting the row makes the code single use; a parallel request that got here too finds nothing.
  const consumed = await prisma.$transaction(async (tx) => {
    const deleted = await tx.emailVerificationCode.deleteMany({ where: { id: row.id } });
    if (deleted.count === 0) return false;
    await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now } });
    return true;
  });
  return consumed ? { type: "ok", userId: user.id } : { type: "invalid" };
}

// ---------------------------------------------------------------- Pending-verification cookie

/*
 * Remembers which email is being verified between sign-up and the code screen. It is signed
 * (can't be forged) and HttpOnly, and it is NOT a session: no account access until verified.
 * `sentAt` drives the on-screen countdown the same way for every address, so the page can't
 * be used to tell new emails from existing ones.
 */
const PENDING_COOKIE = "pending_verification";
type Pending = { email: string; sentAt: number; exp: number };

export function setPending(res: Response, email: string, sentAt = Date.now()): void {
  const exp = Date.now() + V.pendingTtlMs;
  const payload = Buffer.from(JSON.stringify({ email, sentAt, exp } satisfies Pending)).toString("base64url");
  res.cookie(PENDING_COOKIE, `${payload}.${hmac(`pending:${payload}`)}`, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    path: "/",
    expires: new Date(exp),
  });
}

export function getPending(req: Request): Pending | null {
  const raw = req.cookies?.[PENDING_COOKIE];
  if (typeof raw !== "string") return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig || !safeEqual(sig, hmac(`pending:${payload}`))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as Pending;
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

export function clearPending(res: Response): void {
  res.clearCookie(PENDING_COOKIE, { httpOnly: true, secure: config.isProduction, sameSite: "lax", path: "/" });
}
