**The Authentication Slice** 

**What to build** : A complete authentication system with its own interface, ending at a placeholder dashboard. 

**Screens:** \- Create account \- Sign in \- Forgot password, meaning the request form \- Reset password, meaning the form reached from the emailed link \- Email verification, including the code entry and the resend control \- A placeholder dashboard that shows the signed-in user's name and a sign out button, and nothing else 

**Behaviour:** \- A new user can create an account, verify their email, and reach the dashboard \- A returning user can sign in \- A user who forgets their password can reset it and sign in with the new one \- A signed-out user who types the dashboard URL directly is sent to sign in \- Sign out ends the session properly 

**Do not build:** No landing page. No marketing page. No dashboard features. No profile editing, no settings, no social signin, no two-factor. The dashboard is one line of text and a button. 

**Engineering requirements:** 

- Password hashing with an adaptive algorithm, not a general-purpose hash   
- Server-side validation on every input, declared as a schema rather than scattered through handlers, with client-side validation mirroring it for feedback   
- Rate limiting on signin, signup, password reset request, and verification code resend  
- Session management, with the session cookie configured correctly   
- Email verification codes that expire in the database, not only in the interface   
- A resend cooldown enforced on the server   
- Password reset tokens that are single use and time limited   
- A unique constraint on email at the database level   
- An idempotent signup endpoint, so a double submission creates one account   
- Protected route handling, so the dashboard cannot be reached without a session   
- Input groups with labels programmatically bound to inputs, and visible focus states 