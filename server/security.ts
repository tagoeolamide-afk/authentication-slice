import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";

// ---------------------------------------------------------------- Tokens

/** 256-bit URL-safe random token (sessions, reset links). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are high-entropy, so SHA-256 is enough to make a database leak useless. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ---------------------------------------------------------------- Passwords

/** argon2id (the library default) with the OWASP baseline: 19 MiB memory, 2 passes, 1 lane. */
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Spend the same time when the email is unknown, so timing doesn't reveal which emails have accounts. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword("timing-equalisation-dummy-password");
  await verifyPassword(await dummyHash, password);
  return false;
}

// ---------------------------------------------------------------- Rate limiting

export type Rule = { limit: number; windowSec: number };
export type LimitResult = { ok: true } | { ok: false; retryAfterSec: number };

/**
 * Fixed-window counter stored in SQLite. One atomic upsert resets an expired window
 * or increments the count, so concurrent requests can't slip past the limit.
 */
async function bump(key: string, windowMs: number, now: number): Promise<{ count: number; windowStart: number }> {
  const rows = await prisma.$queryRaw<{ count: number | bigint; windowStart: number | bigint }[]>`
    INSERT INTO "RateLimit" ("key", "count", "windowStart") VALUES (${key}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count"       = CASE WHEN "windowStart" <= ${now - windowMs} THEN 1 ELSE "count" + 1 END,
      "windowStart" = CASE WHEN "windowStart" <= ${now - windowMs} THEN ${now} ELSE "windowStart" END
    RETURNING "count", "windowStart"`;
  return { count: Number(rows[0].count), windowStart: Number(rows[0].windowStart) };
}

const secondsLeft = (windowStart: number, windowMs: number, now: number) =>
  Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));

export async function rateLimit(key: string, rule: Rule): Promise<LimitResult> {
  const now = Date.now();
  const windowMs = rule.windowSec * 1000;
  const { count, windowStart } = await bump(key, windowMs, now);
  if (count <= rule.limit) return { ok: true };
  return { ok: false, retryAfterSec: secondsLeft(windowStart, windowMs, now) };
}

// ---------------------------------------------------------------- Failure lockout

/**
 * Counts failures only (e.g. wrong passwords). `limit` failures inside `windowSec` lock the key
 * for `lockoutSec`, measured from the failure that tripped it, so the wait is always the full time.
 */
export type LockoutRule = { limit: number; windowSec: number; lockoutSec: number };

/** Is this key locked right now? Doesn't count anything. */
export async function checkLockout(key: string, rule: LockoutRule): Promise<LimitResult> {
  const row = await prisma.rateLimit.findUnique({ where: { key } });
  if (!row) return { ok: true };
  const now = Date.now();
  const windowMs = rule.windowSec * 1000;
  const windowStart = Number(row.windowStart);
  if (row.count < rule.limit || windowStart + windowMs <= now) return { ok: true };
  return { ok: false, retryAfterSec: secondsLeft(windowStart, windowMs, now) };
}

/** Records one failure. Returns not-ok when this failure (or an earlier one) has locked the key. */
export async function recordFailure(key: string, rule: LockoutRule): Promise<LimitResult> {
  const now = Date.now();
  const windowMs = rule.windowSec * 1000;
  const { count, windowStart } = await bump(key, windowMs, now);
  if (count < rule.limit) return { ok: true };
  if (count === rule.limit) {
    // Move the window so it ends exactly lockoutSec from now; the counter resets after that.
    await prisma.rateLimit.update({ where: { key }, data: { windowStart: BigInt(now - windowMs + rule.lockoutSec * 1000) } });
    return { ok: false, retryAfterSec: rule.lockoutSec };
  }
  return { ok: false, retryAfterSec: secondsLeft(windowStart, windowMs, now) };
}

/** Forget the failures, e.g. after a successful sign-in. */
export async function clearFailures(key: string): Promise<void> {
  await prisma.rateLimit.deleteMany({ where: { key } });
}

/** Checks every rule (each counter advances) and reports the longest wait. */
export async function rateLimitAll(checks: [string, Rule][]): Promise<LimitResult> {
  let longest = 0;
  for (const [key, rule] of checks) {
    const r = await rateLimit(key, rule);
    if (!r.ok) longest = Math.max(longest, r.retryAfterSec);
  }
  return longest ? { ok: false, retryAfterSec: longest } : { ok: true };
}
