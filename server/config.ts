import "dotenv/config";

function requireSecret(): string {
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) throw new Error("AUTH_SECRET must be set in .env (32+ random characters).");
  return secret;
}

/** Every tunable security number lives here so the behaviour is auditable in one place. */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  isProduction: process.env.NODE_ENV === "production",
  authSecret: requireSecret(),

  session: { ttlMs: 7 * 24 * 60 * 60 * 1000 },
  reset: { tokenTtlMs: 30 * 60 * 1000 },
  verification: {
    codeTtlMs: 10 * 60 * 1000,
    maxAttempts: 5,
    resendCooldownMs: 60 * 1000,
    /** How long the browser remembers which email is being verified. */
    pendingTtlMs: 30 * 60 * 1000,
  },

  rateLimits: {
    loginPerIp: { limit: 20, windowSec: 15 * 60 },
    // 5 wrong passwords for one email (from one device) within 15 min lock it for 5 min.
    loginFailuresPerEmailIp: { limit: 5, windowSec: 15 * 60, lockoutSec: 5 * 60 },
    signupPerIp: { limit: 10, windowSec: 60 * 60 },
    // One reset email per address per minute (matches the 60s resend countdown) and 5 per hour.
    forgotCooldownPerEmail: { limit: 1, windowSec: 60 },
    forgotPerEmail: { limit: 5, windowSec: 60 * 60 },
    forgotPerIp: { limit: 20, windowSec: 60 * 60 },
    resetPerIp: { limit: 20, windowSec: 60 * 60 },
    verifyPerIp: { limit: 30, windowSec: 15 * 60 },
    resendPerEmail: { limit: 5, windowSec: 60 * 60 },
    resendPerIp: { limit: 20, windowSec: 60 * 60 },
    existingAccountNoticePerEmail: { limit: 2, windowSec: 60 * 60 },
  },

  mail: {
    transport: (process.env.MAIL_TRANSPORT ?? "outbox") as "outbox" | "smtp",
    from: process.env.MAIL_FROM ?? "shrink <no-reply@shrink.local>",
    smtp: {
      host: process.env.SMTP_HOST ?? "",
      port: Number(process.env.SMTP_PORT ?? 587),
      user: process.env.SMTP_USER ?? "",
      pass: process.env.SMTP_PASS ?? "",
    },
  },
} as const;
