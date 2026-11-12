import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { config } from "./config";

type Mail = { to: string; subject: string; text: string; html: string };

const transporter =
  config.mail.transport === "smtp"
    ? nodemailer.createTransport({
        host: config.mail.smtp.host,
        port: config.mail.smtp.port,
        secure: config.mail.smtp.port === 465,
        auth: config.mail.smtp.user ? { user: config.mail.smtp.user, pass: config.mail.smtp.pass } : undefined,
      })
    : // "outbox": nothing leaves the machine.
      nodemailer.createTransport({ jsonTransport: true });

// With real SMTP, check the login once at startup so a wrong password shows up straight away
// in the terminal, not only when the first email silently fails.
if (config.mail.transport === "smtp") {
  transporter
    .verify()
    .then(() => console.info(`[mail] SMTP ready: sending real email via ${config.mail.smtp.host} as ${config.mail.smtp.user}`))
    .catch((error: Error) => console.error(`[mail] SMTP login failed (${config.mail.smtp.host}): ${error.message}`));
}

export async function sendMail(mail: Mail): Promise<void> {
  await transporter.sendMail({ from: config.mail.from, ...mail });

  if (config.mail.transport === "outbox") {
    const dir = path.join(process.cwd(), ".mail-outbox");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`),
      JSON.stringify({ ...mail, sentAt: new Date().toISOString() }, null, 2),
    );
    console.info(`\n[mail:outbox] To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`);
  }
}

/** Fire-and-forget, so the response time is the same whether or not an email was sent. */
export function sendInBackground(mail: Mail): void {
  sendMail(mail).catch((error) => console.error("[mail] delivery failed", error));
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const wrap = (body: string) =>
  `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a;max-width:480px">${body}<p style="color:#5c5c5c;font-size:14px">shrink</p></div>`;

export function verificationCodeEmail(to: string, name: string, code: string, minutes: number): Mail {
  return {
    to,
    subject: `${code} is your shrink verification code`,
    text: `Hi ${name},\n\nYour verification code is ${code}.\nIt expires in ${minutes} minutes.\n\nIf you didn't create a shrink account, you can ignore this email.`,
    html: wrap(
      `<p>Hi ${escape(name)},</p><p>Your verification code is:</p><p style="font-size:32px;font-weight:bold;letter-spacing:6px">${code}</p><p>It expires in ${minutes} minutes.</p><p>If you didn't create a shrink account, you can ignore this email.</p>`,
    ),
  };
}

/** Sent instead of a code when someone signs up with an address that already has an account. */
export function existingAccountEmail(to: string, name: string, appUrl: string): Mail {
  return {
    to,
    subject: "Someone tried to create a shrink account with your email",
    text: `Hi ${name},\n\nSomeone tried to create a new shrink account with this email address, but you already have one.\n\nLog in: ${appUrl}/index.html\nForgot your password? ${appUrl}/forgot-password.html\n\nIf this wasn't you, no action is needed.`,
    html: wrap(
      `<p>Hi ${escape(name)},</p><p>Someone tried to create a new shrink account with this email address, but you already have one.</p><p><a href="${escape(appUrl)}/index.html">Log in</a> · <a href="${escape(appUrl)}/forgot-password.html">Reset your password</a></p><p>If this wasn't you, no action is needed.</p>`,
    ),
  };
}

export function passwordResetEmail(to: string, name: string, link: string, minutes: number): Mail {
  return {
    to,
    subject: "Reset your shrink password",
    text: `Hi ${name},\n\nReset your password using this link:\n${link}\n\nThe link expires in ${minutes} minutes and can only be used once.\nIf you didn't ask for this, ignore this email; your password won't change.`,
    html: `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a;max-width:480px">
<p>Hi ${escape(name)},</p>
<p><a href="${escape(link)}" style="display:inline-block;background:#ff7904;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Reset your password</a></p>
<p>The link expires in ${minutes} minutes and can only be used once.</p>
<p>If you didn't ask for this, ignore this email; your password won't change.</p>
<p style="color:#5c5c5c;font-size:14px">shrink</p></div>`,
  };
}
