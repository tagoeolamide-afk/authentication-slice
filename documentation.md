# shrink: Authentication Slice

## 1. What This Is

This is a complete sign-in system for a web app called shrink, built from the screen all the way down to the database, and ending at a placeholder dashboard. A new visitor creates an account with their name, email and a password. They are then emailed a 6-digit code, and typing it in proves the email address is theirs and signs them in. A returning user signs in with their email and password. Someone who has forgotten their password asks for a reset link by email and uses it to choose a new one. Once signed in, a person stays signed in on that browser for up to 7 days, until they press "Sign out". Only signed-in people can see the dashboard, which shows their name and a sign-out button. The server handles the security behind each step: it stores passwords in a form that can't be reversed, re-checks every form on the server, blocks repeated guessing, and makes reset links and email codes expire.

## What is deliberately left out 
Everything that isn't signing in has been left out. There is no landing or marketing page, and the dashboard has no features. There is also no profile editing, no settings, no "Sign in with Google" or similar, and no two-step verification. The point of the slice is to prove that the sign-in journey works and is secure from start to finish. Each of those extras is a separate project that would add more screens, more code and more ways for things to go wrong, without proving anything more about signing in itself. Keeping the dashboard to one line of text and a button keeps attention on the part being judged: getting a person in, keeping them in safely, and letting them out.

## 2. How To Run It

From a fresh clone to a working copy on your own computer takes about two minutes: one minute to install, one minute for everything else. No email account is needed. By default, emails are shown in your terminal instead of being sent.

### What to install

| Tool | Version | Why it's needed | Where to get it |
|---|---|---|---|
| **Node.js** | 22 or newer (built and tested on 24) | Runs the server. It comes with `npm`, which installs the project's packages. | https://nodejs.org (the "LTS" download) |
| **Git** | any recent version | Downloads (clones) the project | https://git-scm.com |

There is nothing else to install. The database is SQLite, which is a single file inside the project, so no database server is needed.

### Steps

1. **Download the project and go into its folder.**
   ```
   git clone https://github.com/tagoeolamide-afk/authentication-slice.git
   cd authentication-slice
   ```

2. **Install the packages.**
   ```
   npm install
   ```
   This also prepares the database code automatically, so you don't need to run a separate step for it.

3. **Create your settings file** by copying the example.
   ```
   cp .env.example .env
   ```
   On Windows Command Prompt, use `copy .env.example .env` instead.

4. **Add a secret key.** Run this command to make one:
   ```
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
   Copy the long line it prints, open `.env`, and paste it between the quotes of `AUTH_SECRET=""`. The server refuses to start without it. Every other setting already works as it is.

5. **Create the database.**
   ```
   npm run db:migrate
   ```
   This creates the database file `dev.db` and builds its tables: users, sessions, reset links, email codes and rate limits. When it finishes, it prints "Your database is now in sync with your schema."

6. **Start the app.**
   ```
   npm run dev
   ```
   The terminal prints `shrink running at http://localhost:3000`. The server restarts by itself whenever you change a file.

7. **Open http://localhost:3000** in your browser. You'll see the sign-in page.

**Trying it out:** click through to create an account. The 6-digit verification code is printed in the terminal where `npm run dev` is running, and also saved as a file in the `.mail-outbox/` folder. Password reset links show up in the same two places.

**Viewing the data:** to look inside the database, run `npm run db:studio` in a second terminal. It opens a browser view of every table.

### Environment variables

These settings live in the `.env` file. The project includes [.env.example](.env.example), a template with a note beside each setting. You copy it to `.env` in step 3. `.env` is listed in `.gitignore`, so it is never uploaded to GitHub. Real keys and passwords stay on your own computer.

| Name | Needed? | What it is | Where it comes from |
|---|---|---|---|
| `AUTH_SECRET` | **Yes** | A long random key that protects the stored email codes and the cookie that remembers which email is being verified | You make it yourself, with the command in step 4. It must be at least 32 characters. |
| `DATABASE_URL` | Already set | Where the database file is | Pre-filled in `.env.example` as `file:./dev.db`. No need to change it. |
| `PORT` | Already set | The port the app runs on | Pre-filled as `3000`. Change it only if something else already uses 3000. |
| `APP_URL` | Already set | The app's web address. It is also used to build the links inside emails, like the reset link. | Pre-filled as `http://localhost:3000`. It must match where the app actually runs. |
| `MAIL_TRANSPORT` | Already set | `outbox` shows emails in the terminal; `smtp` sends real emails | Pre-filled as `outbox`, which needs no setup |
| `MAIL_FROM` | Already set | The sender name and address shown on emails | Pre-filled. For real Gmail sending, it must be your own Gmail address. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Only for real email | Your email provider's sending server, and the login for it | From your email provider. For Gmail: `smtp.gmail.com`, port `465`, your Gmail address, and a 16-letter App Password from https://myaccount.google.com/apppasswords. App Passwords need 2-Step Verification turned on, and your normal Gmail password will not work. |
| `NODE_ENV` | Only when deployed | Set to `production` on a live server | You set it on your hosting service. It switches on cookie protections that need HTTPS, so leave it unset on your own computer. |

### If something goes wrong

- **The server stops with "AUTH_SECRET must be set":** step 4 was skipped, or the key is shorter than 32 characters.
- **An error mentioning `EADDRINUSE`, which means the port is already in use:** another program is using that port. Change `PORT` and `APP_URL` in `.env`, for example to `3001` and `http://localhost:3001`.
- **An error mentioning `better-sqlite3`:** the packages were installed with scripts turned off. Run `npm rebuild better-sqlite3`, then `npx prisma generate`.

## 3. The Flow, Step By Step

This section follows one person through the whole journey. They create an account, prove their email, use the dashboard, sign out, sign back in, forget their password, and reset it. Each step says what the person does, what their browser sends, and what the server does with it, naming the file where that happens.

### How the pieces fit together

Every step follows the same path, so it's worth knowing the path once before the story starts.

- **The screens** are plain HTML pages in [login-screen/](login-screen/): one file per screen, styled by [styles.css](login-screen/styles.css).
- **All browser-side behaviour** lives in one file, [login-screen/script.js](login-screen/script.js), shared by every page. Each page's form announces what kind of page it is with a `data-mode` label (`login`, `signup`, `verify`, `forgot` or `reset`). The script looks that label up in a table called `ACTIONS` to know which address to send the form to.
- **Every form is sent as JSON** (a simple text format for data) to an address starting with `/api/auth/`.
- **The server's front door** is [server/index.ts](server/index.ts). It adds security headers to every response, and refuses form submissions that aren't JSON or that come from another website. For pages, it first tidies the address (so `/dashboard` and `/dashboard.html` are treated as the same page) and runs the page guards. Only then does it hand over the HTML file.
- **Every `/api/auth/...` address** is handled in [server/auth-routes.ts](server/auth-routes.ts), one block of code per address. Each block follows the same order:
  1. check the form against its rules in [server/validation.ts](server/validation.ts)
  2. check the rate limits in [server/security.ts](server/security.ts)
  3. do the work
  4. answer

  The work itself is shared out to helper files:
  - [server/security.ts](server/security.ts): password hashing, random tokens, rate limits
  - [server/session.ts](server/session.ts): sign-in cookies and page guards
  - [server/verification.ts](server/verification.ts): email codes
  - [server/mailer.ts](server/mailer.ts): emails
- **The database tables** are described in [prisma/schema.prisma](prisma/schema.prisma).
- **All the time limits and attempt limits** are in [server/config.ts](server/config.ts).

### Step 1: Opening the site
**The person** types `http://localhost:3000` into their browser.

**The browser** asks the server for the home page.

**The server**, in [server/index.ts](server/index.ts), tidies the address `/` into `/index.html`, then runs a page guard called `redirectIfSignedIn` from [server/session.ts](server/session.ts). The guard checks whether this browser already has a valid sign-in cookie. If it does, there is no reason to show a sign-in form, so the person is sent straight to the dashboard. If not, the server sends the sign-in page, `index.html`. The person has no account yet, so they click **Sign up** and get `sign-up.html`, which has the same guard.

### Step 2: Creating an account

**The person** types their full name, email address and a password. While they type, `script.js` checks each box against the same rules the server uses: two names, a real-looking email, and a password with upper and lower case letters, a number and a symbol. It shows any problem straight away. Under the password box it lists the requirements still missing, and each one disappears as it is met. Then they press **Create account**.

**The browser** switches the button to "Creating account…" so it can't be pressed twice. It sends the name, email and password to `POST /api/auth/signup`.

**The server**, in the `/signup` block of [server/auth-routes.ts](server/auth-routes.ts), works through these steps in order:
1. **Checks the form** against `signupSchema` in [server/validation.ts](server/validation.ts). This also trims the email and makes it lowercase. If anything is wrong, it answers with the problem for each box, and `script.js` shows those messages under the right boxes.
2. **Checks the sign-up rate limit** for this device.
3. **Scrambles the password** with argon2id (`hashPassword` in [server/security.ts](server/security.ts)), so the real password is never stored.
4. **Saves the new account and its first email code together**, in a single step. The code is made by `newCode` in [server/verification.ts](server/verification.ts): 6 random digits, stored only in scrambled form, and set to expire in 10 minutes.
5. **Emails the code** through [server/mailer.ts](server/mailer.ts). By default it appears in the terminal instead.

**If the email already has an account**, the database refuses to save a second one, because email addresses must be unique. The server catches that refusal instead of crashing:
- If the existing account was never verified, it re-sends the code, as long as 60 seconds have passed.
- If it was verified, it emails the real owner to say someone tried to sign up with their address.

Either way, the answer looks exactly like a normal sign-up. This means a double-click never makes two accounts, and strangers can't use this form to find out which emails are registered.

Finally, the server gives the browser a short-lived **pending-verification cookie** (`setPending` in [server/verification.ts](server/verification.ts)). It remembers which email is waiting to be checked, and it is signed with `AUTH_SECRET` so it can't be faked. It is **not** a sign-in: it gives no access to the account. The server answers "go and verify", and `script.js` moves the person to `verify-email.html`.

### Step 3: The verification screen

**The person** arrives at "Verify Your Email".

**The browser** asks for the page. Once it loads, `script.js` also asks `GET /api/auth/verify-email/status` which email is being verified and how long until a new code can be requested.

**The server** guards this page in [server/index.ts](server/index.ts). Without a pending-verification cookie, there is nothing to verify, so the person is sent back to sign-in. The `/verify-email/status` block reads the cookie and returns the email address and the seconds left on the 60-second resend wait. The page shows the email address, and the "Resend code" button counts down from there.

### Step 4: Entering the code

**The person** finds the 6-digit code in their email (or the terminal), types it in and presses **Verify email**.

**The browser** sends the code to `POST /api/auth/verify-email`.

**The server**, in the `/verify-email` block, first:
1. checks that the pending cookie is still valid
2. checks that the code is exactly 6 digits (`verifySchema`)
3. checks the rate limit

Then `checkCode` in [server/verification.ts](server/verification.ts) does the real work:
- **Is the code still in date?** If it's older than 10 minutes, the person is told to request a new one.
- **The attempt is counted before the comparison.** Only 5 guesses are allowed per code, and even guesses arriving at the same moment can't get past that.
- **The scrambled version of what was typed is compared with the stored one.** If they don't match, the person sees "That code is incorrect. 4 attempts left."
- **If they match,** the code is deleted, so it can never be used again, and the account is marked as verified.

Then the server:
- removes the pending cookie
- **signs the person in** with `startSession` in [server/session.ts](server/session.ts). This makes a long random token, saves only its scrambled form in the `Session` table with an expiry 7 days away, and gives the browser the real token in a cookie that page scripts can't read.

`script.js` then moves the person to the dashboard.

**Two side paths on this screen:**
- **Resend code** sends `POST /api/auth/verify-email/resend`. That block checks the hourly limits, then calls `issueCode` in [server/verification.ts](server/verification.ts). `issueCode` only replaces the code if the last one was sent more than 60 seconds ago. Otherwise it answers with the seconds still to wait, and the button shows that countdown. The wait is enforced here on the server, not just by the button.
- **Use a different email** sends `POST /api/auth/verify-email/cancel`. That removes the pending cookie and returns the person to sign-up.

### Step 5: The dashboard

**The person** lands on the dashboard, and comes back to it any time in the next 7 days without signing in again.

**The browser** asks for `/dashboard.html`. Once the page loads, `script.js` (its "Dashboard page" section) asks `GET /api/auth/me` who is signed in.

**The server** guards the page before sending it. In [server/index.ts](server/index.ts), the address is tidied first, so every spelling of "dashboard" reaches the same guard. Then `requireSessionPage` in [server/session.ts](server/session.ts) calls `currentUser`. `currentUser` takes the cookie, scrambles it the same way, and looks for a matching row in the `Session` table that hasn't expired. If there is none, the page is never sent, and the person is redirected to sign-in. If there is one, the page is sent with an instruction not to keep a saved copy, so the Back button can't show it after sign-out. The `/me` block runs the same `currentUser` check and returns the person's name. The page shows "Signed in as …" and a **Sign out** button.

### Step 6: Signing out

**The person** presses **Sign out**.

**The browser** sends `POST /api/auth/logout`.

**The server**, in the `/logout` block, calls `endSession` in [server/session.ts](server/session.ts). It **deletes the session row from the database** and tells the browser to throw the cookie away. Deleting the row is what makes sign-out real: even a copied cookie no longer works, because there's nothing left for it to match. `script.js` returns the person to the sign-in page. If they press Back or type the dashboard address, the guard from step 5 turns them away.

### Step 7: Signing back in

**The person** types their email and password on the sign-in page and presses **Login**.

**The browser** sends both to `POST /api/auth/login`.

**The server**, in the `/login` block of [server/auth-routes.ts](server/auth-routes.ts), works through these steps in order:
1. **Checks the form** against `loginSchema`. Sign-in only checks that a password was entered, so the password rules are not revealed here.
2. **Checks the per-device limit.**
3. **Checks whether this email is locked** (`checkLockout` in [server/security.ts](server/security.ts)). The lock is per device. If the lock is on, the server refuses before even looking at the password.
4. **Checks the password** against the stored scrambled one (`verifyPassword`). If the email has no account, it checks against a dummy password (`verifyAgainstDummy`) instead. That way the answer takes the same time either way, and timing can't reveal which emails exist.

**If the password is wrong**, `recordFailure` counts it, and the person sees "Email or password is incorrect." The **5th** wrong password in 15 minutes locks that email on this device for 5 minutes. The server then answers with the exact number of seconds left. `script.js` (its "Sign-in lockout" section) shows a live `4:59` countdown and switches off the password box and the Login button until it reaches zero. A page refresh doesn't skip it.

**If the password is right**, the failure count is cleared:
- If the account was never verified, the server sends a new code and a pending cookie, and the person goes back to step 3.
- Otherwise, `startSession` signs them in, exactly as in step 4, and they reach the dashboard.

### Step 8: Forgetting the password

**The person** clicks **Forgot password?** on the sign-in page, types their email on `forgot-password.html`, and presses **Send reset link**.

**The browser** sends the email to `POST /api/auth/forgot-password`.

**The server**, in the `/forgot-password` block, checks the email (`forgotSchema`) and the limits: one link per address per minute, 5 per hour, and 20 per device. If an account exists, it:
- makes a long random token (`generateToken` in [server/security.ts](server/security.ts))
- saves only its scrambled form in the `PasswordResetToken` table, with an expiry 30 minutes away
- emails a link built from `APP_URL`, `…/reset-password.html?token=…` (`passwordResetEmail` in [server/mailer.ts](server/mailer.ts))

**The answer is the same whether or not the account exists**, so this form can't be used to find out who is registered. The page switches to "Check Your Email", with a **Resend link** button that has its own 60-second wait.

### Step 9: Opening the reset link

**The person** clicks the link in the email.

**The browser** opens `reset-password.html?token=…`. Straight away, `script.js` (its "Reset page" section) copies the token and removes it from the address bar and browser history. It then asks `GET /api/auth/reset-password/validate?token=…` whether the link is still good.

**The server**, in [server/index.ts](server/index.ts), sends this page with a rule that stops the token leaking to other websites. The `/reset-password/validate` block looks the scrambled token up and answers whether it exists, is unused and is in date. If not, the page shows "Link Expired" before the person wastes time typing a new password.

### Step 10: Choosing a new password

**The person** types a new password twice and presses **Reset password**.

**The browser** sends the token, the new password and the confirmation to `POST /api/auth/reset-password`.

**The server**, in the `/reset-password` block, first:
1. checks the form (`resetSchema`): the new password must follow the same rules as sign-up, and the two passwords must match
2. checks the rate limit
3. scrambles the new password

Then it does everything else as **one all-or-nothing database step**:
- **Claims the token:** it marks the token as used, but only if it is still unused and in date. Two clicks at the same moment can't both succeed, which is what makes the link single use.
- **Saves the new password.**
- **Marks the email as verified:** opening a link sent to that inbox proves it belongs to the person.
- **Deletes every session for the account,** signing it out on every device.
- **Cancels any other reset links** for the account.

The page shows "Password Reset" with a **Log in** button. The person signs in with the new password, back at step 7, and the journey is complete.

### Finding any behaviour in the code

| If you want to find… | Look in… |
|---|---|
| What a screen looks like | [login-screen/](login-screen/) (one HTML file per screen) and [styles.css](login-screen/styles.css) |
| What happens when a button is pressed or a box is typed in | [login-screen/script.js](login-screen/script.js). Find the page's `data-mode` in the `ACTIONS` table, or the section named after the feature. |
| Which page is allowed to load for whom | [server/index.ts](server/index.ts) (page guards) and [server/session.ts](server/session.ts) |
| What the server does when a form is sent | [server/auth-routes.ts](server/auth-routes.ts), one block per `/api/auth/...` address, in journey order |
| The rules a form must pass | [server/validation.ts](server/validation.ts) (server) and the `rules` table in [script.js](login-screen/script.js) (browser) |
| Passwords, tokens and rate limits | [server/security.ts](server/security.ts) |
| Email codes and the pending-verification cookie | [server/verification.ts](server/verification.ts) |
| What the emails say and how they're sent | [server/mailer.ts](server/mailer.ts) |
| Any time limit or attempt limit | [server/config.ts](server/config.ts) |
| What's stored in the database | [prisma/schema.prisma](prisma/schema.prisma) |

## 4. The Data Model

The database has five tables. They are defined in [prisma/schema.prisma](prisma/schema.prisma), and the exact SQL that built them is in [prisma/migrations/](prisma/migrations/). The SQL below is copied from those migration files, so it is what the database actually contains.

A few words used throughout:
- **Column:** one piece of information in every row, like a column in a spreadsheet.
- **`NOT NULL`:** the column must always have a value. It can never be left empty.
- **Nullable:** the column is allowed to be empty. Here, "empty" always means something specific.
- **`PRIMARY KEY`:** the row's ID. It must be present and unique.
- **`UNIQUE`:** no two rows may share the same value in this column.
- **`FOREIGN KEY`:** this column must point at a row that really exists in another table.

### How the tables connect

```
User ──┬── many Session              (one per signed-in browser)
       ├── many PasswordResetToken   (one per reset link sent)
       └── at most one EmailVerificationCode

RateLimit stands alone. It counts attempts by email or device, not by account.
```

### `User`: one row per account

```sql
CREATE TABLE "User" (
    "id"              TEXT     NOT NULL PRIMARY KEY,
    "name"            TEXT     NOT NULL,
    "email"           TEXT     NOT NULL,
    "passwordHash"    TEXT     NOT NULL,
    "emailVerifiedAt" DATETIME,
    "createdAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       DATETIME NOT NULL
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
```

| Column | The decision, and why |
|---|---|
| `id` | **A long random ID, not 1, 2, 3.** Counting IDs would reveal how many people have signed up, and would let someone guess other accounts' IDs. |
| `name` | **Not nullable**, because the dashboard's only job is to show it, and sign-up requires it. |
| `email` | **`UNIQUE` and not nullable.** One address means one account, and every account needs an address to verify and to reset its password. The app trims it and makes it lowercase before saving, so the unique rule compares like with like. |
| `passwordHash` | **Not nullable**, because there is no "Sign in with Google", so every account must have a password. It is **text** because it stores the whole argon2id result: the scrambled password plus its random salt and the settings used. That way, an old hash can still be checked if the settings are raised later. The real password is never stored. |
| `emailVerifiedAt` | **Nullable, on purpose.** Empty means "not verified yet". It is a date rather than a simple yes/no so that one column records both *whether* the email was verified and *when*. |
| `createdAt`, `updatedAt` | Filled in automatically, for tracing problems later. |

### `Session`: one row per signed-in browser

```sql
CREATE TABLE "Session" (
    "id"        TEXT     NOT NULL PRIMARY KEY,
    "tokenHash" TEXT     NOT NULL,
    "userId"    TEXT     NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
```

| Column | The decision, and why |
|---|---|
| `tokenHash` | **The scrambled (SHA-256) form of the token in the cookie, never the token itself.** Someone who copied the database couldn't use it to sign in. It is **`UNIQUE`** so one cookie can only ever match one session. SHA-256 is enough here, unlike for passwords, because the token is 256 random bits and there's nothing to guess. |
| `userId` | **A foreign key to `User`, not nullable.** Every session must belong to a real account. **`ON DELETE CASCADE`** means deleting an account deletes its sessions too. |
| `expiresAt` | **Not nullable**, so a session that lasts forever can't exist. Every session is written with an end date, 7 days after sign-in. |
| index on `userId` | Makes "sign this person out everywhere", which happens after a password reset, a quick lookup. |

### `PasswordResetToken`: one row per reset link emailed

```sql
CREATE TABLE "PasswordResetToken" (
    "id"        TEXT     NOT NULL PRIMARY KEY,
    "tokenHash" TEXT     NOT NULL,
    "userId"    TEXT     NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt"    DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
```

| Column | The decision, and why |
|---|---|
| `tokenHash` | **Scrambled and `UNIQUE`,** for the same reasons as sessions. A link found in the database can't be rebuilt, and one link matches one row. |
| `userId` | **A foreign key with cascade:** a reset link always belongs to a real account. |
| `expiresAt` | **Not nullable**, so a link that never expires can't be made. This is the "time limited" half of the requirement, and the server checks it, not the page. |
| `usedAt` | **Nullable, on purpose.** Empty means "not used yet". It is filled in at the moment of use, and the server only accepts a link while it is still empty. This is the "single use" half. A date rather than yes/no records *when* it was used. |
| No unique rule on `userId` | **Deliberately left off.** Someone may ask for a second link before using the first. Once one link is used, the others are all cancelled. |

### `EmailVerificationCode`: the one live code for an unverified account

```sql
CREATE TABLE "EmailVerificationCode" (
    "id"         TEXT     NOT NULL PRIMARY KEY,
    "userId"     TEXT     NOT NULL,
    "codeHash"   TEXT     NOT NULL,
    "expiresAt"  DATETIME NOT NULL,
    "attempts"   INTEGER  NOT NULL DEFAULT 0,
    "lastSentAt" DATETIME NOT NULL,
    "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailVerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EmailVerificationCode_userId_key" ON "EmailVerificationCode"("userId");
```

| Column | The decision, and why |
|---|---|
| `userId` | **`UNIQUE` as well as a foreign key.** Each account can have at most one live code. Sending a new code replaces the old row, so an older code can't still be valid somewhere. |
| `codeHash` | **Scrambled with a secret key** (HMAC with `AUTH_SECRET`), not plain SHA-256. A 6-digit code has only a million possibilities, so a plain scramble could be cracked by trying them all. The secret key makes that impossible without the server's `.env`. |
| `expiresAt` | **Not nullable.** The brief requires codes to expire *in the database*, not just on screen. Every code is written with an end time 10 minutes away, and the server refuses it after that. |
| `attempts` | **A whole number, starting at 0.** It counts guesses at this code. The server allows 5, then the code stops working. |
| `lastSentAt` | **Not nullable.** It records when the code was last emailed, which is what the server uses to enforce the 60-second resend wait. |

### `RateLimit`: one counter per kind of attempt

```sql
CREATE TABLE "RateLimit" (
    "key"         TEXT    NOT NULL PRIMARY KEY,
    "count"       INTEGER NOT NULL,
    "windowStart" BIGINT  NOT NULL
);
```

| Column | The decision, and why |
|---|---|
| `key` | **Text naming what is being counted**, for example `login:ip:…`, or `login:fail:<email>:<device>` for wrong passwords. It is the **primary key**, so each counter is exactly one row. This is what lets the server add one to a counter in a single safe step ("add the row, or if it exists, increase it"). With two rows for the same key, the count would be split in half and the limit would be doubled. |
| `count` | How many attempts there have been in the current time window. |
| `windowStart` | **A plain number (milliseconds since 1970), not a date.** The server does its "has the window ended?" maths inside the same single database step, and plain numbers make that simple. It is a **big** integer because today's millisecond count is too large for a normal one. |
| No link to `User` | **Deliberately not a foreign key.** Limits must also count attempts on emails that have no account. Otherwise, being limited or not would reveal which emails are registered. |

The database is SQLite in development, so dates are stored as text (`2026-11-11T09:22:49.610+00:00`). The comment at the top of [prisma/schema.prisma](prisma/schema.prisma) explains how to move to PostgreSQL without changing the tables.

### Which constraints make an invalid state impossible?

A rule in the database still holds even if the app's code has a bug, because the database refuses the write whoever sends it. Each rule below was tested by trying to break it on a copy of the database, through the app's own database connection. Every attempt was refused.

| Constraint | The invalid state it makes impossible | Tested |
|---|---|---|
| `UNIQUE` on `User.email` | **Two accounts with the same email.** This is what makes a double-clicked sign-up create one account, even when both requests arrive at the same moment and both pass the app's "does it exist yet?" check. | ✅ refused: `Unique constraint failed on the fields: (email)` |
| `NOT NULL` on `User.passwordHash` | **An account with no password.** No future code path can create an account that can be signed into without one. | ✅ refused |
| `FOREIGN KEY` on `Session.userId` | **A session for an account that doesn't exist.** That would be a sign-in cookie for nobody, and it would leave `/me` with no one to return. | ✅ refused: `Foreign key constraint violated` |
| `UNIQUE` on `Session.tokenHash` | **One cookie matching two sessions,** where the server couldn't tell which person is signed in. | ✅ refused |
| `NOT NULL` on `Session.expiresAt` | **A session that never expires.** | ✅ refused |
| `FOREIGN KEY` on `PasswordResetToken.userId` | **A reset link that resets nobody's password,** or the wrong person's. | ✅ refused |
| `UNIQUE` on `PasswordResetToken.tokenHash` | **One link matching two accounts.** | ✅ refused |
| `NOT NULL` on `PasswordResetToken.expiresAt` | **A reset link with no time limit.** | (same `NOT NULL` rule as above) |
| `UNIQUE` on `EmailVerificationCode.userId` | **Two live codes for one account.** An old code would otherwise stay valid after a resend, and the 5-guess limit would apply to each code separately. | ✅ refused |
| `PRIMARY KEY` on `RateLimit.key` | **A counter split across two rows,** which would let an attacker get double the allowed attempts. | ✅ refused |
| `ON DELETE CASCADE` on all three foreign keys | **Leftover sessions, links or codes after an account is deleted.** In particular, a sign-in cookie that outlives its account. | ✅ deleting a test account left 0 sessions, 0 links and 0 codes |

**Foreign keys are switched on.** SQLite only checks foreign keys when they are switched on for the connection. The app's connection was checked, and they are.

### What the schema does not prevent

These two cases are only protected by the app's code, not by the database. Both got through in the test above.

| Not prevented by the database | What protects it today |
|---|---|
| **The same email in different capitals.** The database would accept both `ola@example.com` and `OLA@example.com`, because SQLite's `UNIQUE` treats capitals as different letters. | The app trims and lowercases every email before saving, in `signupSchema` in [server/validation.ts](server/validation.ts). Every email arriving through the app is therefore already in one form. |
| **Impossible numbers,** such as `attempts` above 5, a negative `count`, an expiry date earlier than the creation date, or a blank name. There are no `CHECK` rules, which would be the database's way of refusing out-of-range values. | The server only ever writes in-range values: the attempt limit is enforced in `checkCode` in [server/verification.ts](server/verification.ts), and every form passes [server/validation.ts](server/validation.ts) first. |

Both could be moved into the database. A case-insensitive rule on `email` (`COLLATE NOCASE`) and `CHECK` rules on `attempts`, `count` and `name` would make these invalid states impossible too, not just avoided.

## 5. The Concepts

Eight ideas hold this slice together. Each one below answers the same four questions: what it is, why it's needed, how I built it, and what I chose against.

### Password Hashing

**What it is.** Hashing turns a password into a scrambled string that can't be turned back into the original. When someone signs in, I scramble what they typed the same way and compare the two scrambled strings. The real password is never stored anywhere.

**Why it is needed.** Suppose my database is ever copied by someone who shouldn't have it. With plain passwords, that person could sign in as every user immediately. Because people reuse passwords, they could also try those passwords on each person's email, bank and social accounts. With hashing, a stolen database gives them only scrambled strings, and each one is slow and expensive to crack by guessing.

**How I implemented it.** I used **argon2id** through the `@node-rs/argon2` library, in `hashPassword` and `verifyPassword` in [server/security.ts](server/security.ts). The settings are the OWASP baseline: OWASP is a widely used web-security standard. Each check uses 19 MB of memory and 2 passes.

```ts
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2);
}
```

The password is hashed at sign-up and at password reset, and checked at sign-in. The memory cost is the point. One honest sign-in barely notices 19 MB. But an attacker trying billions of guesses needs 19 MB for *each* guess, which stops them running thousands at once on graphics cards. There is one more detail. When someone signs in with an email that has no account, `verifyAgainstDummy` still runs a full check against a dummy hash. Without it, a wrong email would get a noticeably faster answer than a wrong password, and that timing would reveal which emails are registered.

**What I chose against, and why.**
- **SHA-256** is a general-purpose hash designed to be fast, which is exactly why it is wrong for passwords: a fast hash means fast guessing. (I do use SHA-256 for session and reset tokens. Those are 256 random bits, so there is nothing to guess.)
- **bcrypt** is the well-known alternative, and it's a reasonable choice. I chose against it for two reasons. First, it silently ignores everything after the 72nd byte of a password, and this app allows passwords up to 128 characters. Second, it only costs processor time, not memory, which makes it cheaper to attack with graphics cards.
- Argon2id won the Password Hashing Competition, it is OWASP's first recommendation, and the library I used installs without extra build tools. So there was no reason to pick the older option.

### Rate Limiting

**What it is.** Rate limiting counts how many times someone tries an action, and refuses further tries for a while once they pass a limit. It works like a bouncer who lets you try the door a few times, but turns you away after the twentieth try in a minute.

**Why it is needed.** Each of the four limited actions fails in its own way without it:
- **Sign-in:** a script can try thousands of passwords against one account until a common one works. Each try also costs a deliberately expensive argon2 check, so the same flood slows the server for everyone.
- **Sign-up:** a script can create thousands of fake accounts, and send thousands of emails from my address, which damages its reputation with email providers.
- **Forgot password:** anyone can type a stranger's email and flood their inbox with reset emails.
- **Resend code:** the same flooding, through the verification screen.

**How I implemented it.** The counters live in a database table, `RateLimit`. The function `bump` in [server/security.ts](server/security.ts) adds one to a counter, or starts it again when its time window has ended, in a **single database step**:

```sql
INSERT INTO "RateLimit" ("key", "count", "windowStart") VALUES (${key}, 1, ${now})
ON CONFLICT ("key") DO UPDATE SET
  "count"       = CASE WHEN "windowStart" <= ${now - windowMs} THEN 1 ELSE "count" + 1 END,
  "windowStart" = CASE WHEN "windowStart" <= ${now - windowMs} THEN ${now} ELSE "windowStart" END
RETURNING "count", "windowStart"
```

Doing it as one step means ten requests arriving at the same moment still count as ten. Each route in [server/auth-routes.ts](server/auth-routes.ts) checks its limits before doing any work. All the numbers are in [server/config.ts](server/config.ts), for example sign-up allows 10 per device per hour. Sign-in has an extra rule, handled by `checkLockout` and `recordFailure`. Five wrong passwords for one email from one device lock that pair for 5 minutes. The server returns the exact seconds left, and the sign-in screen shows a live countdown with the password box and button switched off. A blocked request gets the answer "429 Too Many Requests", along with how long to wait.

**What I chose against, and why.**
- **Keeping the counters in the server's memory**, which is what most rate-limit libraries do by default. Every restart would wipe them, and in development the server restarts on every file save. If the app ever ran as two copies, each would keep its own count and the limit would double.
- **Redis**, the usual fast store for counters. It would add a second service to install and run, which works against the brief's ten-minute setup. The database already handles a small table like this easily.
- **Counting sign-in failures by email alone.** That would let anyone lock a stranger out of their own account by typing the stranger's email five times. So the lock applies to the email *and* the device, and a separate per-device limit catches someone trying many emails.

### Client-Side Versus Server-Side Validation

**What it is.** Validation means checking that what someone typed makes sense before acting on it. For example: is this a real email address, and is the password long enough? **Client-side** validation happens in the browser, while the person types. **Server-side** validation happens on the server after the form is sent.

**Why it is needed.** The two do different jobs, and each fails without the other.
- **Without client-side checks**, people only find a mistake after pressing the button and waiting for the server. The page feels slow and unhelpful.
- **Without server-side checks**, the rules are only a suggestion. Anyone can skip the page and send whatever they like straight to the server with a single command. That could be an empty password, an email that's really a long chain of junk, or a "name" made of code. It would then go straight into the database.

The browser checks are for the person's benefit. The server checks are the ones that count.

**How I implemented it.** The server rules are declared as **schemas** (sets of rules for a whole form) with the `zod` library, all in one file: [server/validation.ts](server/validation.ts). Every route checks its form first, before doing anything else. The sign-up route starts like this:

```ts
authRouter.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ fieldErrors: fieldErrors(parsed.error) });
```

The browser rules are in a `rules` table in [login-screen/script.js](login-screen/script.js). Each input box names its rule in the HTML, for example `data-rule="newPassword"`. Both sides use the same limits and the **same messages word for word**, so a mistake reads the same whether the browser or the server catches it. The browser checks while the person types, when they leave a box, and when they submit. The server's answer comes back in the same shape, so its messages appear under the right box too.

**What I chose against, and why.**
- **One shared rules file for both sides.** This would be the ideal, because the two copies could never drift apart. But the screens are plain JavaScript with no build step, so the browser can't load the server's TypeScript files. Adding a bundler (a tool that packages code for the browser) just to share one file would add tooling the slice doesn't otherwise need. I accepted two copies kept in step by hand. The identical messages make any drift easy to spot.
- **The browser's built-in validation**, such as `required` and `type="email"`. Its pop-up messages look different in every browser, can't be styled, and disappear too quickly to read. The forms switch them off (`novalidate`) and show the app's own messages under each box, linked to the box for screen readers.

### Session Management: Sessions or Tokens

**What it is.** After someone signs in once, the server needs a way to recognise them on every later visit without asking for the password again. A **session** works like a festival wristband. At sign-in, the server gives the browser a random code in a cookie (a small note the browser sends back automatically), and keeps its own list of which codes are valid. On each visit, the server checks the code against its list.

**Why it is needed.** Without it, the person would have to type their password on every page. Done badly, it fails in ways that hurt:
- A code that can be guessed lets anyone in.
- A cookie that page scripts can read can be stolen by any bad code that gets onto the page.
- A sign-out that only deletes the browser's cookie leaves a copied cookie working for days.

**How I implemented it.** `startSession` in [server/session.ts](server/session.ts) makes a 256-bit random token. It stores only the token's SHA-256 scramble, with an expiry 7 days away, and sends the real token in a cookie:

```ts
export async function startSession(res: Response, userId: string): Promise<void> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + config.session.ttlMs);
  await prisma.session.create({ data: { userId, tokenHash: sha256(token), expiresAt } });
  res.cookie(SESSION_COOKIE, token, cookieOptions(expiresAt));
}
```

The cookie is set up so that:
- page scripts can't read it (`HttpOnly`)
- it isn't sent along when another website submits a form to this one (`SameSite=Lax`)
- when the app is live, it only travels over HTTPS (`Secure`) and only for exactly this site (the `__Host-` name)

`currentUser` looks the scrambled token up on every request. `endSession` deletes the row at sign-out, so even a copied cookie stops working. A password reset deletes every session for the account.

**What I chose against, and why.** The main alternative is a **self-contained token** (a JWT): a signed note that says "this is user 42, valid until Friday". The server can check it without looking anything up. I chose against it because the brief requires that "sign out ends the session properly". A JWT stays valid until its expiry whatever happens. If one were copied, signing out wouldn't stop it, and neither would a password reset, unless I also kept a database list of cancelled tokens. That list would be a session table under another name. The cost of real sessions is one database lookup per visit, which is tiny for an app this size. I also chose against keeping the token in the browser's local storage, where any script on the page can read it. A cookie marked `HttpOnly` can't be read by scripts at all.

### Token and Code Expiry, and Why Expiry Must Live in the Database

**What it is.** Expiry gives every email code, reset link and session an end time, after which it no longer works. Email codes last 10 minutes, reset links 30 minutes and sessions 7 days. "In the database" means the end time is saved on the server, next to the code itself, and the server checks it every time the code is used.

**Why it is needed.**
- **Without expiry,** a reset link sitting in an old email becomes a permanent key to the account, usable years later by anyone who gets into that inbox. A 6-digit code that never expires can be guessed at slowly forever.
- **Without expiry in the database,** the limit is only for show. If the 10 minutes lived only in the page's countdown, someone could skip the page and send the code straight to the server an hour later, or simply change their computer's clock. The page belongs to the user; only the server's record can't be argued with.

**How I implemented it.** Each code is written with its end time at the moment it's made. This is `newCode` in [server/verification.ts](server/verification.ts):

```ts
data: { codeHash: hashCode(userId, code), expiresAt: new Date(now.getTime() + V.codeTtlMs), attempts: 0, lastSentAt: now },
```

The expiry check is built into the database update itself, so expiry and single use are checked together in one step. Here is the password reset, in [server/auth-routes.ts](server/auth-routes.ts):

```ts
// Single use: only one request can flip usedAt from null, and only before expiry.
const claimed = await tx.passwordResetToken.updateMany({
  where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
  data: { usedAt: now },
});
if (claimed.count !== 1) return false;
```

`expiresAt` is a required column in all three tables (`NOT NULL`), so the database won't store a code without an end time. The session check in `currentUser` refuses expired sessions in the same way.

**What I chose against, and why.**
- **Putting the expiry inside the link itself**, as a signed, self-contained token. This needs no database row. But the brief also requires links to be **single use**, and a self-contained token can't know it has already been used without a database record. Once a record is needed anyway, the expiry belongs in it.
- **A scheduled clean-up job** that deletes expired rows every few minutes. Instead, every use checks the end time, so an expired row is useless the moment it expires, whether or not anything has tidied it up. Expired rows are left in place (expired sessions are deleted when someone tries to use them). This means there is no background job to set up, or to forget to run. For an app with real traffic, I'd add a nightly clean-up to keep the tables small, but it would be housekeeping, not security.

### Idempotency

**What it is.** An action is idempotent if doing it twice has the same effect as doing it once. A lift button is a good example: pressing it five times still calls one lift. For sign-up, it means the same form sent twice still makes exactly one account.

**Why it is needed.** Forms get sent twice all the time: an impatient double-click, a slow connection where the browser retries, or someone pressing Back and submitting again. Without idempotency, each of those could make a second account with the same email, and then sign-in has two possible passwords and no way to choose. The obvious fix, "check whether the email exists, then create it", fails when both requests arrive together. Each one checks, both see "no account yet", and both create one.

**How I implemented it.** There are three layers.
1. **The button.** It switches to "Creating account…" and turns off after the first click (`setLoading` in [login-screen/script.js](login-screen/script.js)).
2. **The database.** The `UNIQUE` rule on email is what actually guarantees one account. Whatever reaches the server, the database refuses a second account with the same email.
3. **The server.** It treats that refusal as "already done" rather than as an error. Here is the `/signup` route in [server/auth-routes.ts](server/auth-routes.ts):

```ts
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
```

After catching the duplicate, the server re-sends the code, but only if the 60-second resend wait allows it, so a double-click doesn't send two emails. Then it gives the same "go and verify" answer as the first request. Five identical sign-ups sent at the same moment produced one account and five identical answers.

**What I chose against, and why.**
- **Idempotency keys.** This is the standard method for payments: the browser attaches a unique ID to each submission, and the server stores the answer for each ID so a repeat gets the same answer back. It needs an extra table, and extra logic in the browser to make and keep the IDs. Sign-up already has a natural unique ID, the email address, and the database already enforces it. The extra machinery would protect against nothing more.
- **Relying on the disabled button alone.** It stops most double-clicks, but not a browser retry, a second tab, or a request sent without the page at all.

### Database Constraints as a Last Line of Defence

**What it is.** A constraint is a rule the database itself enforces on every write. It refuses any change that breaks the rule, whichever part of the app sent it. Examples are "no two accounts may share an email", "every session must belong to a real account" and "every session must have an end time".

**Why it is needed.** App code has bugs, and it gets changed by people who don't know every rule. A future feature, an import script or a hurried fix can easily skip a check that the sign-up route performs. Without constraints, that bug goes straight into the data, where it causes problems that are hard to trace, for example:
- two accounts on one email, each with its own password
- a sign-in cookie for an account that no longer exists
- a session with no end date that never expires

With constraints, the bug causes an error at the moment it happens instead, and the data stays correct.

**How I implemented it.** The rules are declared in [prisma/schema.prisma](prisma/schema.prisma), and turned into real database rules by the migrations in [prisma/migrations/](prisma/migrations/). For example:

```sql
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
CREATE UNIQUE INDEX "EmailVerificationCode_userId_key" ON "EmailVerificationCode"("userId");
```

Section 4 lists every constraint, the invalid state it makes impossible, and a test showing the database refusing it. That includes writes sent by code that skips the app completely.

**What I chose against, and why.**
- **Checking everything in the app code only.** It's less work up front, but every rule then depends on every future piece of code remembering it, and "check, then write" can always be beaten by two requests arriving together. The database is the one place every write must pass through.
- **There are two rules I haven't added yet,** and I'm being open about them rather than leaving them hidden. There are no `CHECK` rules for impossible numbers, such as more than 5 code attempts. Email uniqueness also doesn't ignore capitals. The tool I use to build the database (Prisma) can't express either one in its normal schema format, so they would need hand-written SQL. Today the app's code prevents both cases. Section 4 names them as the schema's known gaps.

### Protected Routes

**What it is.** A route is a page address, like `/dashboard.html`. A protected route is one only signed-in people may open. Anyone else who types the address is sent to the sign-in page instead.

**Why it is needed.** Without protection, signing in is just a suggestion: anyone who knows or guesses the address can open the dashboard. There's also a quieter failure. If the check happens only in the page's own script, the server has already sent the page before the script decides to redirect. Someone with scripts switched off, or anyone reading the raw response, still receives it. Also, after sign-out, the Back button can show a saved copy of the dashboard from the browser's memory.

**How I implemented it.** The check runs on the server, before the page is sent. In [server/index.ts](server/index.ts), the dashboard address goes through a guard first:

```ts
app.get("/dashboard.html", requireSessionPage, (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
```

`requireSessionPage` in [server/session.ts](server/session.ts) calls `currentUser`. It either lets the request through or redirects to `/index.html`, so a signed-out visitor never receives the page at all. `Cache-Control: no-store` tells the browser not to keep a saved copy, so the Back button after sign-out asks the server again and is turned away. Before any guard runs, [server/index.ts](server/index.ts) also tidies every way of writing a page's address into one standard form. Without this, `/dashboard` or `/DASHBOARD` could slip past a guard written for `/dashboard.html`. The page then asks `/api/auth/me` for the person's name, which needs the same valid session.

**What I chose against, and why.**
- **A check in the browser only**, where the page loads and its script redirects if nobody is signed in. It's easy, but the page has already been delivered, and the check can be skipped by turning off scripts. I kept a browser check only as a backup, for when a session expires while the page is open.
- **Building the dashboard as a single-page app** that shows or hides its content based on a sign-in flag. That has the same weakness, and it would need a framework the brief doesn't call for. The server-side guard is a few lines and can't be bypassed from the browser.

## 6. What Went Wrong

These are the real problems I hit while building and testing the slice, in the order they happened. Some of the investigation went down wrong paths, and those are included, because they're part of how each cause was found.

### Problem 1: The sign-in block didn't actually block anything

**The symptom.** I typed a wrong password several times. On the sixth try, a message appeared: "Too many attempts. Try again in 15 minutes." But the form stayed fully usable. I could clear the password box, type again and press Login straight away. The message was there, but nothing on the screen enforced it.

**The investigation.**
- I checked the server first, by sending wrong passwords straight to `POST /api/auth/login` without the page. On the sixth try it answered `429 Too Many Requests` with `retryAfterSec: 899`, and it kept refusing after that. **So the server was blocking correctly.** Every extra press of Login was being refused quietly, but nothing told the person.
- Next I read the submit code in [login-screen/script.js](login-screen/script.js). Every failed request, whatever the reason, went to the same `handleFailure` function, which only shows the error text. Nothing in it looked at *why* the request failed, so a lockout was treated exactly like a typo.
- I also found a second problem in the server's timing. The 15 minutes were measured from the **first** wrong attempt, not from the moment of the lock. So someone locked after the fifth attempt might really wait 12 minutes, or 3, while the message promised 15.
- After rewriting it, my first test run produced a wait of **90 seconds** instead of 5 minutes, and I spent time assuming the new lock code was wrong. **It wasn't.** A separate, older rule allows 20 sign-in attempts per device every 15 minutes, and all my test runs from the same computer had used it up. The 90 seconds came from that rule. I cleared the test counters and reran, and the lock gave exactly 300 seconds.

**The cause.** There were two causes. The browser had no idea that a "too many attempts" answer meant "switch the form off". And the server's counter counted every sign-in attempt, right or wrong, in a window that started at the first one. A correct password could even push the count up.

**The fix.**
- **On the server**, in [server/security.ts](server/security.ts), I added a separate lockout counter that counts **wrong passwords only**:
  - `checkLockout` refuses straight away while a lock is on, before even checking the password.
  - `recordFailure` counts each wrong password. On the fifth, it moves the time window so it ends exactly 5 minutes from that moment.
  - `clearFailures` resets the count after a correct sign-in.
- **In the browser**, `script.js` now recognises a 429 on the sign-in page. It shows a live `4:59` countdown, switches off the password box, the show/hide eye and the Login button, and switches them back on at zero. It saves the end time for the browser tab, so refreshing doesn't skip the wait.

### Problem 2: A fresh copy of the project failed to install

**The symptom.** While checking the setup steps for Section 2, I downloaded the project from GitHub into an empty folder and ran `npm install`. It ended with:

```
npm error command failed
npm error command C:\Windows\system32\cmd.exe /d /s /c prisma generate
```

On my own copy of the project, `npm install` had always worked.

**The investigation.**
- My test script had printed `install exit=0`, meaning "success", **right under the error**. That was misleading. I had piped the output through `tail` to shorten it, and `$?` gave me `tail`'s result, not `npm`'s. The install had failed; my check was reading the wrong command.
- I searched the npm error log for anything useful. It contained nothing that pointed at the cause.
- I confirmed the packages themselves had installed (196 folders in `node_modules`). But `server/generated/` was missing. That folder holds the database code that `prisma generate` writes, so the failing step was the one that makes it.
- The later steps then seemed to work. `npm run db:migrate` also generates the database code, so it quietly made up for the failed step. **A reviewer could miss the error completely, or give up at it.**
- I ran `prisma generate` by hand twice, with and without the `.env` file present. Without it: `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`. With it: success.

**The cause.** [prisma.config.ts](prisma.config.ts) read the database address with Prisma's `env("DATABASE_URL")` helper, which stops with an error if the setting doesn't exist. On a fresh clone, `.env` doesn't exist yet, because the setup steps create it *after* `npm install`. It only ever worked on my machine because my `.env` was already there: a classic "works on my machine".

**The fix.** I gave the config the same fallback the server already used in [server/db.ts](server/db.ts):

```ts
datasource: { url: process.env.DATABASE_URL ?? "file:./dev.db" },
```

Then I cloned a second fresh copy, swapped in the fixed file, and followed Section 2 exactly. It took 55 seconds from clone to a working sign-up.

### Problem 3: The dashboard could be reached without signing in, by leaving off ".html"

**The symptom.** While reviewing protected routes, I noticed the server serves pages without their `.html` ending, so `/sign-up` works as well as `/sign-up.html`. I tested the dashboard while signed out:

```
/dashboard.html        [302] -> http://localhost:3000/index.html
/dashboard             [200]
```

The first was redirected to sign-in, as it should be. The second answered `200`, meaning the server sent the dashboard page.

**The investigation.**
- **I checked what actually leaked.** The page came back as an empty shell, "Signed in as" with no name. The name is fetched separately from `/api/auth/me`, which checks the session and refused. The page's own script then sent the visitor to sign-in a moment later. So no personal data leaked. But the brief says the dashboard can't be reached without a session, and the server was delivering it.
- I tried other spellings. `/DASHBOARD.html` and `/dashboard.html/` were already caught, because Express's routing ignores capitals and a trailing slash. `/./dashboard.html` also got through, but only when sent with a tool that keeps the `./`. Real browsers tidy that away before sending. That was a weaker case, but the same kind of hole.

**The cause.** In [server/index.ts](server/index.ts), the guard was attached to the exact address `/dashboard.html`. The file server further down was set up with `extensions: ["html"]`, which means "if `/dashboard` isn't a file, try `/dashboard.html`". So `/dashboard` never matched the guard, fell through to the file server, and was handed the file anyway. The guard and the file server disagreed about which address was "the dashboard".

**The fix.** Before any guard runs, the server now tidies every page address into one standard form. It decodes it, resolves `./` and `../`, lowercases it, and strips trailing slashes and `.html`. If what remains names a known page, the address becomes `/<page>.html`. The guards then only ever see one spelling. All 10 spellings I tried while signed out are now redirected, and the signed-in, sign-out and other page tests still pass.

### Problem 4: Focus was invisible on a box that was showing an error

**The symptom.** While checking the accessibility requirement ("visible focus states"), I found that moving with the Tab key into a box with a red error border changed nothing on screen. Normal boxes turned orange on focus. Error boxes stayed exactly the same red either way, so a keyboard user couldn't see where they were at the moment they most needed to.

**The investigation.**
- My first tool for this was a one-line script to check every label was linked to its box. **It crashed** on a typing mistake in its own pattern, which had nothing to do with the app. I rewrote it as a proper script file. It showed all 9 boxes correctly linked, so labels weren't the problem.
- I then read the focus rules in [login-screen/styles.css](login-screen/styles.css). The focus rule set the border to orange, and the error rule set it to red. Both rules carry equal weight in CSS, and when two rules are equal, the one written later wins. The error rule came later.
- While there, I measured the focus orange against white: **2.63 to 1** contrast. The accessibility guideline (WCAG) asks for at least 3 to 1 for focus highlights. The highlight was also only a 1px line.

**The cause.** The error rule's position in the file meant it silently overrode the focus rule whenever both applied. And the focus colour was the brand orange, which is too light against white to count as a clear highlight.

**The fix.**
- I added a separate focus colour, `--focus: #e06600`. It's a deeper shade of the same orange, at 3.46 to 1 contrast, and the brand orange stays everywhere else.
- Focused boxes now get a 2px line, drawn as a shadow so the box doesn't change size.
- Focused error boxes get a thicker red line, so focus always shows.
- There's a transparent outline, which only appears in Windows High Contrast mode, where shadows are hidden.

### Problem 5: A valid reset link was refused, but the bug was in my test

**The symptom.** To test that reset links expire after 30 minutes, I needed a link older than 30 minutes, and a fresh one to compare against. Real emails weren't being sent at that point, so I created both links directly in the database. The expired link was refused, as expected. But the **fresh link was refused too**, with "This reset link has expired or has already been used."

**The investigation.**
- Before that, my first test script crashed. The test account it looked for, `flowcheck…@example.com`, was gone, because the database had been cleared since the earlier tests. I switched to another test account.
- With the fresh link refused, I first suspected the app's reset code. But the page's own check (`/reset-password/validate`) said the same fresh link was **valid**. Two parts of the app disagreeing about one link pointed away from the logic and towards the data.
- The difference between them was where the date comparison happened. The page check compares the expiry in JavaScript, after reading the row. The reset itself compares it **inside the database query** (`expiresAt > now`).
- So I looked at how dates were stored. The rows the app makes held text: `2026-11-11T09:22:49.610+00:00`. My two test rows held plain numbers: `1794390513941`. SQLite was comparing a number with a piece of text, and that comparison never comes out "later", so every link looked expired.

**The cause.** My test wrote dates in a different format from the one the app uses. **The app was fine.**

**The fix.** I rewrote the two test rows with dates in the app's text format and reran. Expired link: refused. Fresh link: accepted, and the password was changed. Second use: refused. Made-up link: refused. The lesson I took: when testing by writing to the database directly, copy the app's own storage format, or create the data through the app.

### Problem 6: After switching to real email, sign-ups looked fine but no emails arrived

**The symptom.** I switched the mail setting from the test outbox to real Gmail sending, but the Gmail App Password wasn't filled in yet. The server kept running, and sign-up still said "check your email". But no email was sent, and the codes no longer appeared in the terminal either. The screen gave no sign that anything was wrong.

**The investigation.** Emails are sent "in the background" (`sendInBackground` in [server/mailer.ts](server/mailer.ts)). The server answers the person straight away and sends the email afterwards. That's deliberate: the answer then takes the same time whether or not the email exists, which hides which emails have accounts. The side effect is that a failed send can't change the answer. It only shows up as a `[mail] delivery failed` line in the terminal, once for each email, and only when an email is attempted. With a wrong or missing password, every email would fail, and the only evidence was scattered across the terminal.

**The cause.** Nothing checked the Gmail login until the first real email was sent. A wrong setting only showed up as repeated, easy-to-miss delivery errors.

**The fix.** When the server starts in Gmail mode, it now logs in to the mail server once (`transporter.verify()` in [server/mailer.ts](server/mailer.ts)). It prints either `[mail] SMTP ready: sending real email via smtp.gmail.com as …` or `[mail] SMTP login failed …`, so a bad password shows up at startup, before anyone signs up.

**A related near miss.** While writing [.env.example](.env.example), I first put a placeholder text in `AUTH_SECRET`. It happened to be exactly 32 characters long, and the server accepts any secret of 32 characters or more. Anyone copying the file would have run the app with a publicly known secret, with no warning. I caught it before publishing and changed it back to empty, so the server refuses to start until a real secret is pasted in.

## 7. What This Slice Does Not Handle

These are the limits I know about. They fall into four groups: what breaks at scale, what must be added before real users touch it, what I left out because it was outside the brief, and what I left out because I ran out of time.

### A known security weakness

**Someone can set up an account in another person's name before that person signs up.** Here is how:
1. An attacker signs up with a victim's email address and a password the attacker knows. The account is created but stays unverified, because the code goes to the victim's inbox.
2. Later, the real owner signs up with their own email and their own password. The email is already taken, so the server re-sends a code to the existing unverified account. But it **throws away the password the real owner just typed**. That is the `/signup` route in [server/auth-routes.ts](server/auth-routes.ts), the branch that calls `issueCode(existing)`.
3. The real owner enters the code and is signed in. Their account now carries the **attacker's** password and name, and it is now verified. The attacker can sign in to it whenever they like. Meanwhile, the owner's own password won't work the next time they sign in.

This is known as "account pre-hijacking". I found it by reading the code while writing this section, not by testing it live. The fix is for a repeat sign-up on an unverified account to replace the stored name and password with the new ones, and to cancel any older code. Then only the person who reads the inbox ends up with the password they chose. **This must be fixed before real users touch the slice.**

### What breaks at scale

- **The database is one file (SQLite).** It allows only one write at a time, and only one server can use it. Many sign-ups at once would queue up behind each other, and the app can't be run on two servers sharing the load. The tables are designed to move to PostgreSQL unchanged; the steps are in the comment at the top of [prisma/schema.prisma](prisma/schema.prisma).
- **Password checks are deliberately expensive.** Each sign-in, sign-up or reset uses 19 MB of memory for a moment. A hundred at the same time need about 2 GB. Under heavy load, the server would need more memory or a queue, or the protection itself would slow the site.
- **Limits by device are really limits by IP address,** and many real people can share one IP: an office, a school, a mobile network. The limit of 20 sign-in attempts per IP every 15 minutes could block a whole office. And an attacker spreading guesses across thousands of IPs, a "botnet", gets past every per-IP limit. Only the per-email lockout still applies to them. Real traffic would need a CAPTCHA, or smarter limits.
- **The time windows reset all at once.** A limit of 10 per hour allows 10 just before the hour ends and 10 more just after: 20 in a couple of minutes.
- **Nothing ever deletes old rows.** Expired sessions are removed only when someone tries to use them. Used and expired reset links, abandoned codes, unverified accounts and old rate-limit counters stay forever. A counter row is made for every email anyone types into the forms, real or not. The tables only grow.
- **Emails have no queue and no retry.** They're sent from the web server itself. If the mail service is down at that moment, the email is lost, and the only trace is a line in the terminal. Free Gmail also caps sending at about 500 emails a day.

### What it would need before real users touched it

- **Fix the account pre-hijacking weakness** above.
- **Run over HTTPS, with `NODE_ENV="production"`.** That switches on the `Secure` cookie and the `__Host-` cookie name. Without HTTPS, anyone on the same Wi-Fi can read the sign-in cookie.
- **Add the missing security headers.** There's no Content-Security-Policy, which would block injected scripts, and no HSTS, which would make browsers always use HTTPS. Today only `nosniff`, `X-Frame-Options` and `Referrer-Policy` are set, in [server/index.ts](server/index.ts).
- **A real email service on its own domain,** such as Postmark, Resend or Amazon SES, set up with the records that prove the email is genuine (SPF, DKIM and DMARC). Codes sent from a personal Gmail are likely to land in spam.
- **Automated tests.** There are none. Every behaviour in this document was checked by hand, by sending requests to the running server. Nothing would catch a future change that breaks a security rule.
- **Logging and alerts.** The server prints only emails and crashes to the terminal. There's no record of who signed in when, no warning when someone is guessing passwords, and no alert when emails fail.
- **Database backups.** The whole database is one file, with no copy anywhere.
- **A check against known leaked passwords.** The password rules accept `Password1@`, which appears in every list of leaked passwords. Services like Have I Been Pwned can check a password against those lists without seeing it.
- **A plan for changing `AUTH_SECRET`.** If it ever leaks, replacing it immediately invalidates every email code and pending-verification cookie, and there's no way to switch over gradually.
- **A setting for how many proxies sit in front of the server.** In production, the server trusts exactly one proxy to report each visitor's real IP address (`trust proxy` in [server/index.ts](server/index.ts)). If the hosting setup has more than one, every visitor appears to have the same IP. Then one shared limit blocks everybody.

### Left out because it was outside the brief

The brief said not to build these, and I didn't:
- a landing or marketing page
- dashboard features: the dashboard is one line of text and a button
- profile editing and settings
- "Sign in with Google" and other social sign-in
- two-step verification

Some things real users would expect also fall under "no profile editing or settings", so they aren't built either:
- **changing your email address**
- **deleting your account**, which data-protection laws such as GDPR require
- **downloading your data**, also required by those laws
- **seeing your signed-in devices** and signing out of one of them (today the only way to sign out everywhere is to reset your password)
- **choosing how long to stay signed in:** sessions always last a fixed 7 days from sign-in, however often the person uses the app

### Left out because I ran out of time

These were within reach, but are not done:
- **Fixing the account pre-hijacking weakness.** I found it while writing this section.
- **Closing the two database gaps from Section 4:**
  - the database doesn't treat `OLA@…` and `ola@…` as the same email
  - there are no `CHECK` rules for impossible values, such as more than 5 code attempts

  Today the app's code prevents both cases; the database doesn't.
- **Automated tests,** and a clean-up job for old rows.
- **A request log in the terminal.** The terminal shows nothing for ordinary page visits and sign-ins, which made testing harder. It also clears itself on every restart.
- **The wording of the per-device limit.** When the per-IP limit is hit rather than the 5-wrong-passwords lock, the sign-in screen still says "Too many incorrect attempts", even if some of those attempts were correct.
- **"Use a different email" on the verification screen.** It takes the person back to sign-up, but leaves the unverified account in the database. The abandoned address then stays taken by an account nobody will finish setting up, until someone signs up with it again.
- **The font licence.** The repository includes the Satoshi font files. I haven't checked whether their licence allows sharing the files publicly. If it doesn't, the pages should load the font from its official source instead.

## 8. If I Built This Again

I would write the automated tests first, before the code. I'd turn each line of the brief, and each attack I was defending against, into a test that sends real requests to the server and checks the answer. For example: "a signed-out visitor to the dashboard is redirected", "the sixth wrong password is refused and the form stays locked for five minutes", "a second sign-up with the same email doesn't change the account's password". Every serious problem in this slice was found late and by hand. The lockout that showed a message but didn't lock anything was found by trying it in a browser. The dashboard reachable at `/dashboard` was found by typing different addresses. The account pre-hijacking weakness was only found by reading the code while writing Section 7, after everything was supposedly finished. Each was a gap between what the brief said and what I had checked, and I'd only checked what I happened to think of. Tests written from the brief would have made me state each rule precisely before building it, caught these problems the moment they appeared, and kept catching them after every later change. Instead, every behaviour this document claims is backed only by checks run once, by hand, at the time of writing. That is the weakest part of the slice: not any single feature, but the fact that nothing proves the features still work tomorrow.
