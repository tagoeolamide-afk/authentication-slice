# shrink — authentication

Vanilla HTML/CSS/JS pages (`login-screen/`) served by an Express + Prisma backend (`server/`), storing data in SQLite.

## Run it

```bash
npm install            # first time only
npm rebuild better-sqlite3   # only if you installed with --ignore-scripts
npx prisma migrate dev # creates dev.db with the tables
npm run dev            # http://localhost:3000  (restarts on file changes)
```

Browse the stored data with `npm run db:studio`. Plain `npx prisma studio` answers "not supported" with this SQLite setup in Prisma 7.10; `scripts/studio.mjs` works around that.

## Pages

| Page | What it does |
|---|---|
| `/index.html` | Log in → `/dashboard.html` |
| `/sign-up.html` | Create an account → `/verify-email.html` |
| `/verify-email.html` | Enter the 6-digit emailed code (resend after 60s) → signed in → `/dashboard.html` |
| `/forgot-password.html` | Emails a reset link (in dev it's printed in the terminal and saved in `.mail-outbox/`) |
| `/reset-password.html?token=…` | Sets a new password; signs the account out everywhere |
| `/dashboard.html` | Only served with a valid session; shows the name and a Sign out button |

## API (`/api/auth/…`, JSON only)

| Method & path | Body | Result |
|---|---|---|
| `POST /signup` | `name, email, password` | 202 `{ next: "verify" }` for new *and* existing emails (the owner of an existing one is emailed instead) · 400 field errors |
| `GET /verify-email/status` | – | `{ email, retryAfterSec }` for the code screen |
| `POST /verify-email` | `code` | 200 + session cookie · 400 wrong / expired / too many attempts |
| `POST /verify-email/resend` | – | 200 `{ retryAfterSec }` · 429 inside the 60s cooldown |
| `POST /verify-email/cancel` | – | 204, forgets the pending email |
| `POST /login` | `email, password` | 200 + session cookie · 202 `{ next: "verify" }` if the email was never verified · 401 generic error |
| `POST /logout` | – | 204, session deleted |
| `GET /me` | – | current user or 401 |
| `POST /forgot-password` | `email` | always 200 (doesn't reveal whether the account exists) |
| `GET /reset-password/validate?token=` | – | `{ valid }` |
| `POST /reset-password` | `token, password, confirmPassword` | 200 · 400 invalid/used/expired |

All routes answer 429 with `retryAfterSec` when rate limited.

## Security in place

- Passwords hashed with argon2id; plain passwords are never stored or logged.
- Every field re-validated on the server with the same rules and messages as the browser (`server/validation.ts`).
- Session cookie: random 256-bit token, only its SHA-256 stored; `HttpOnly`, `SameSite=Lax`, `Secure` + `__Host-` prefix in production; 7 days.
- Reset links: single use, expire after 30 minutes, stored hashed; using one signs out every session.
- Rate limits on login, sign-up, forgot and reset (limits in `server/config.ts`), stored in the database.
- Verification codes: 6 digits, stored as a keyed hash, expire after 10 minutes in the database, 5 attempts, 60s resend cooldown enforced on the server. No session until verified.
- Sign-up gives the same answer whether or not the email already has an account.
- Unique email enforced by the database, so a double submission can't create two accounts.
- API accepts JSON only and rejects other origins (CSRF protection).

## Moving to PostgreSQL later

1. In `prisma/schema.prisma`, set `provider = "postgresql"`.
2. `npm i @prisma/adapter-pg` and use `PrismaPg` in `server/db.ts`.
3. Set `DATABASE_URL="postgresql://postgres:PASSWORD@localhost:5432/shrink"` in `.env`, then `npx prisma migrate dev`.
