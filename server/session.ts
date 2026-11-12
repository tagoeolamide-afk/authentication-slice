import type { CookieOptions, NextFunction, Request, Response } from "express";
import { config } from "./config";
import { prisma } from "./db";
import { generateToken, sha256 } from "./security";

/**
 * In production the `__Host-` prefix makes the browser refuse the cookie unless it is
 * Secure, Path=/ and has no Domain, so a subdomain can't set or overwrite it.
 */
export const SESSION_COOKIE = config.isProduction ? "__Host-session" : "session";

const cookieOptions = (expires: Date): CookieOptions => ({
  httpOnly: true, // not readable from JavaScript
  secure: config.isProduction, // HTTPS only in production
  sameSite: "lax", // not sent on cross-site POSTs
  path: "/",
  expires,
});

export async function startSession(res: Response, userId: string): Promise<void> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + config.session.ttlMs);
  await prisma.session.create({ data: { userId, tokenHash: sha256(token), expiresAt } });
  res.cookie(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export type SessionUser = { id: string; name: string; email: string };

/** The cookie must match an unexpired session row; anything else counts as signed out. */
export async function currentUser(req: Request): Promise<SessionUser | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string" || !token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  return session.user;
}

/** Deletes the session row (so the cookie is useless even if copied) and clears the cookie. */
export async function endSession(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === "string" && token) {
    await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  }
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(new Date(0)), expires: undefined });
}

/** Page guard: signed-out visitors are sent to the login page. */
export function requireSessionPage(req: Request, res: Response, next: NextFunction) {
  currentUser(req)
    .then((user) => (user ? next() : res.redirect(302, "/index.html")))
    .catch(next);
}

/** Page guard: signed-in visitors skip the login / sign-up pages. */
export function redirectIfSignedIn(req: Request, res: Response, next: NextFunction) {
  currentUser(req)
    .then((user) => (user ? res.redirect(302, "/dashboard.html") : next()))
    .catch(next);
}
