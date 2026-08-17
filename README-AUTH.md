# Golden Sands Ledger — Google Authentication v1

This package adds:

- Sign in with Google
- Server-side Google ID-token signature verification
- Approved-employee email lookup
- Google `sub` account linking
- HttpOnly D1-backed login sessions
- Login nonce protection
- 7-day sessions
- Logout / session revocation
- Business-scoped permission enforcement on the Worker
- Permission-aware navigation
- Employees only see businesses assigned to them once auth is enforced
- Employee Google email editing

## SAFETY DESIGN

Authentication starts in setup mode:

`AUTH_ENFORCE = "false"`

Do NOT switch it to `true` until the owner's real Google email is saved in
Employees and Google login has been successfully tested.

## 1. Apply the D1 migration

npx wrangler d1 execute golden-sands-ledger --remote --file=./auth-migration.sql

## 2. Copy this package into the repository and commit/push it

The site will continue to work normally because auth enforcement is still off.

## 3. Create a Google OAuth Web Client

Use Google Cloud Console → Google Auth Platform / Credentials.

Application type: Web application

Authorized JavaScript origin:

https://golden-sands-ledger.kbenejam95.workers.dev

Copy the generated Client ID.

## 4. Configure the Client ID

Edit `wrangler.jsonc`:

"GOOGLE_CLIENT_ID": "YOUR_REAL_CLIENT_ID.apps.googleusercontent.com"

Keep:

"AUTH_ENFORCE": "false"

Commit and push.

## 5. Set the owner's real Google email

Ledger → Employees → Ko'vash → Edit Employee

Replace the placeholder owner email with the exact Google account email that
will be used to sign in.

## 6. Test sign-in while enforcement is OFF

Use the Sign in with Google control in the top bar.

After successful login, confirm the top-right identity changes to the signed-in
employee.

Test in Incognito as well.

## 7. Enforce authentication only after the owner login works

Change in `wrangler.jsonc`:

"AUTH_ENFORCE": "true"

Commit and push.

After that, users who are not authenticated cannot access the API, and only
approved active employees can sign in.

## Employee permissions

The Worker checks the employee's D1 permissions, not just the browser UI.

Examples:

- `register` → complete sales
- `inventory_edit` → add inventory / stock intake
- `transfers` → transfer stock
- `notebook` → write notebook notices
- `employees` → add/edit employee profiles
- `permissions` → change employee business permissions
- `businesses` → create/edit businesses
- `settings` → company settings

The company owner bypasses ordinary business permission checks.
