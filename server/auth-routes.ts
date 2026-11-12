import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { isUniqueViolation, prisma } from "./db";
import { existingAccountEmail, passwordResetEmail, sendInBackground } from "./mailer";
import {
  checkLockout,
  clearFailures,
  generateToken,
  hashPassword,
  rateLimitAll,
  recordFailure,
  sha256,
  verifyAgainstDummy,
  verifyPassword,
} from "./security";
import { currentUser, endSession, startSession } from "./session";
import { fieldErrors, forgotSchema, loginSchema, resetSchema, signupSchema, verifySchema } from "./validation";
import { checkCode, clearPending, emailCode, getPending, issueCode, newCode, setPending } from "./verification";

/*
 * JSON API used by the pages in login-screen/.
 *   400 { fieldErrors }        validation failed (same messages as the browser checks)
 *   401 / 409 { error | fieldErrors }
 *   429 { error, retryAfterSec } rate limited
 */

const RL = config.rateLimits;
export const authRouter = Router();

const ip = (req: Request) => req.ip ?? "unknown";

function tooMany(res: Response, retryAfterSec: number) {
  const minutes = Math.ceil(retryAfterSec / 60);
  res
    .status(429)
    .set("Retry-After", String(retryAfterSec))
    .json({
      error:
        retryAfterSec < 60
          ? `Too many attempts. Try again in ${retryAfterSec} seconds.`
          : `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      retryAfterSec,
    });
}

// ---------------------------------------------------------------- Sign up

/*
 * Idempotent and enumeration-resistant: a new email, a double submission and an email that
 * already has an account all get the same 202 "check your email" answer and the same next
 * screen. Only the inbox owner can tell the difference.
 */
authRouter.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ fieldErrors: fieldErrors(parsed.error) });

  const limited = await rateLimitAll([[`signup:ip:${ip(req)}`, RL.signupPerIp]]);
  if (!limited.ok) return tooMany(res, limited.retryAfterSec);

  const { name, email, password } = parsed.data;
  // Hash before touching the database so every branch takes the same time.
  const passwordHash = await hashPassword(password);
  const pendingResponse = () => {
    setPending(res, email);
    return res.status(202).json({ next: "verify" });
  };

  try {
    const id = randomUUID();
    const { code, data } = newCode(id);
    // User and first code are created together, so a duplicate request always finds the code row.
    await prisma.user.create({ data: { id, name, email, passwordHash, verificationCode: { create: data } } });
    emailCode({ email, name }, code);
    return pendingResponse();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  // The unique constraint on email guaranteed no second account was created.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && !existing.emailVerifiedAt) {
    await issueCode(existing); // re-sends only if the cooldown allows
  } else if (existing) {
    const notice = await rateLimitAll([[`notice:${email}`, RL.existingAccountNoticePerEmail]]);
    if (notice.ok) sendInBackground(existingAccountEmail(existing.email, existing.name, config.appUrl));
  }
  return pendingResponse();
});

// ---------------------------------------------------------------- Email verification

/** What the code screen needs. The countdown comes from the cookie, identical for every email. */
authRouter.get("/verify-email/status", (req, res) => {
  const pending = getPending(req);
  if (!pending) return res.status(401).json({ error: "Your verification session has expired. Sign up or log in again." });
  const waitMs = pending.sentAt + config.verification.resendCooldownMs - Date.now();
  res.set("Cache-Control", "no-store").json({ email: pending.email, retryAfterSec: Math.max(0, Math.ceil(waitMs / 1000)) });
});

authRouter.post("/verify-email", async (req, res) => {
  const pending = getPending(req);
  if (!pending) return res.status(401).json({ error: "Your verification session has expired. Sign up or log in again." });

  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ fieldErrors: fieldErrors(parsed.error) });

  const limited = await rateLimitAll([[`verify:ip:${ip(req)}`, RL.verifyPerIp]]);
  if (!limited.ok) return tooMany(res, limited.retryAfterSec);

  const result = await checkCode(pending.email, parsed.data.code);
  switch (result.type) {
    case "expired":
      return res.status(400).json({ fieldErrors: { code: "This code has expired. Request a new one below." } });
    case "too_many_attempts":
      return res.status(400).json({ fieldErrors: { code: "Too many incorrect attempts. Request a new code below." } });
    case "invalid": {
      const left = result.attemptsLeft;
      const suffix = left === undefined ? "" : ` ${left} attempt${left === 1 ? "" : "s"} left.`;
      return res.status(400).json({ fieldErrors: { code: `That code is incorrect.${suffix}` } });
    }
    case "ok": {
      clearPending(res);
      await startSession(res, result.userId);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
      return res.json({ user: { name: user.name, email: user.email } });
    }
  }
});

authRouter.post("/verify-email/resend", async (req, res) => {
  const pending = getPending(req);
  if (!pending) return res.status(401).json({ error: "Your verification session has expired. Sign up or log in again." });

  const limited = await rateLimitAll([
    [`resend:email:${pending.email}`, RL.resendPerEmail],
    [`resend:ip:${ip(req)}`, RL.resendPerIp],
  ]);
  if (!limited.ok) return tooMany(res, limited.retryAfterSec);

  const cooldownSec = config.verification.resendCooldownMs / 1000;
  const user = await prisma.user.findUnique({ where: { email: pending.email } });
  // Unknown or already-verified address: behave exactly like a successful send.
  if (user && !user.emailVerifiedAt) {
    const result = await issueCode(user);
    if (!result.sent) {
      return res
        .status(429)
        .json({ error: `Please wait ${result.retryAfterSec} seconds before requesting another code.`, retryAfterSec: result.retryAfterSec });
    }
  }
  setPending(res, pending.email);
  return res.json({ ok: true, retryAfterSec: cooldownSec });
});

/** "Use a different email": forget the pending address. */
authRouter.post("/verify-email/cancel", (_req, res) => {
  clearPending(res);
  res.status(204).end();
});

// ---------------------------------------------------------------- Log in / out

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ fieldErrors: fieldErrors(parsed.error) });
  const { email, password } = parsed.data;

  const limited = await rateLimitAll([[`login:ip:${ip(req)}`, RL.loginPerIp]]);
  if (!limited.ok) return tooMany(res, limited.retryAfterSec);

  // Locked after too many wrong passwords: refuse before even checking this one.
  const failKey = `login:fail:${email}:${ip(req)}`;
  const locked = await checkLockout(failKey, RL.loginFailuresPerEmailIp);
  if (!locked.ok) return tooMany(res, locked.retryAfterSec);

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user ? await verifyPassword(user.passwordHash, password) : await verifyAgainstDummy(password);

  // One message for both cases, so the response doesn't reveal which emails have accounts.
  if (!user || !valid) {
    const failure = await recordFailure(failKey, RL.loginFailuresPerEmailIp);
    if (!failure.ok) return tooMany(res, failure.retryAfterSec);
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  await clearFailures(failKey);

  // Right password but the email was never verified: send them to the code screen, not in.
  if (!user.emailVerifiedAt) {
    await issueCode(user);
    setPending(res, user.email);
    return res.status(202).json({ next: "verify" });
  }

  await startSession(res, user.id);
  return res.json({ user: { name: user.name, email: user.email } });
});

authRouter.post("/logout", async (req, res) => {
  await endSession(req, res);
  res.status(204).end();
});

authRouter.get("/me", async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in." });
  res.set("Cache-Control", "no-store").json({ user: { name: user.name, email: user.email } });
});

// ---------------------------------------------------------------- Forgot / reset password

authRouter.post("/forgot-password", async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ fieldErrors: fieldErrors(parsed.error) });
  const { email } = parsed.data;

  // Limits are keyed on the email typed, whether or not it exists, so they reveal nothing.
  const limited = await rateLimitAll([
    [`forgot:cooldown:${email}`, RL.forgotCooldownPerEmail],
    [`forgot:email:${email}`, RL.forgotPerEmail],
    [`forgot:ip:${ip(req)}`, RL.forgotPerIp],
  ]);
  if (!limited.ok) return tooMany(res, limited.retryAfterSec);

  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    const token = generateToken();
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + config.reset.tokenTtlMs) },
    });
    const link = `${config.appUrl}/reset-password.html?token=${encodeURIComponent(token)}`;
    sendInBackground(passwordResetEmail(user.email, user.name, link, config.reset.tokenTtlMs / 60_000));
  }

  // Identical response either way.
  return res.json({ ok: true });
});

/** Lets the reset page say "this link has expired" before the user types a new password. */
authRouter.get("/reset-password/validate", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (token.length < 16 || token.length > 256) return res.json({ valid: false });
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  res.set("Cache-Control", "no-store").json({ valid: !!row && !row.usedAt && row.expiresAt > new Date() });
});

authRouter.post("/reset-password", async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    if (errors.token) return res.status(400).json({ error: "This reset link is invalid. Request a new one." });
    return res.status(400).json({ fieldErrors: errors });
  }

  const limited = await rateLimitAll([[`reset:ip:${ip(req)}`, RL.resetPerIp]]);
  if (!limited.ok) return tooMany(res, limited.retryAfterSec);

  const tokenHash = sha256(parsed.data.token);
  const passwordHash = await hashPassword(parsed.data.password);
  const now = new Date();

  const ok = await prisma.$transaction(async (tx) => {
    // Single use: only one request can flip usedAt from null, and only before expiry.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return false;

    const { userId } = await tx.passwordResetToken.findUniqueOrThrow({ where: { tokenHash } });
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    // Opening the emailed link proves the user owns the address, so it counts as verified.
    await tx.user.update({ where: { id: userId }, data: { passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? now } });
    await tx.emailVerificationCode.deleteMany({ where: { userId } });
    // Sign out everywhere and cancel any other outstanding reset links.
    await tx.session.deleteMany({ where: { userId } });
    await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
    return true;
  });

  if (!ok) return res.status(400).json({ error: "This reset link has expired or has already been used. Request a new one." });
  return res.json({ ok: true });
});
