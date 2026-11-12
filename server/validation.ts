import { z } from "zod";

/**
 * Server-side copy of the rules in login-screen/script.js. The browser checks give instant
 * feedback; these are the ones that actually count, because anyone can bypass the browser.
 */

const email = z
  .string({ error: "Email cannot be left empty" })
  .trim()
  .min(1, "Email cannot be left empty")
  .max(254, "Enter a valid email address, like name@example.com")
  .toLowerCase()
  .pipe(z.email("Enter a valid email address, like name@example.com"));

const name = z
  .string({ error: "Full name cannot be left empty" })
  .trim()
  .min(1, "Full name cannot be left empty")
  .max(100, "Use 100 characters or fewer")
  .regex(/^[\p{L}\s]+$/u, "Full name can only contain letters")
  .refine((v) => v.split(/\s+/).length >= 2, "Enter your first and last name")
  // Store single spaces between names.
  .transform((v) => v.replace(/\s+/g, " "));

const newPassword = z
  .string({ error: "Password cannot be left empty" })
  .min(1, "Password cannot be left empty")
  .max(128, "Use 128 characters or fewer")
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number")
  .regex(/[@#$&*]/, "Password must contain a special character (@#$&*)")
  .min(8, "Minimum of 8 characters");

export const signupSchema = z.object({ name, email, password: newPassword });

export const loginSchema = z.object({
  email,
  // Login only checks presence, so the policy isn't revealed and older passwords keep working.
  password: z.string({ error: "Password cannot be left empty" }).min(1, "Password cannot be left empty").max(128),
});

export const forgotSchema = z.object({ email });

export const resetSchema = z
  .object({
    token: z.string().min(16).max(256),
    password: newPassword,
    confirmPassword: z.string({ error: "Confirm password cannot be left empty" }).min(1, "Confirm password cannot be left empty"),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

export const verifySchema = z.object({
  code: z
    .string({ error: "Verification code cannot be left empty" })
    .trim()
    .min(1, "Verification code cannot be left empty")
    .regex(/^\d+$/, "The code can only contain numbers")
    .regex(/^\d{6}$/, "Enter the 6-digit code from your email"),
});

/** First message per field, in the shape the front end expects: { email: "...", password: "..." }. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
