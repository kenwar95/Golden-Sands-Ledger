# Golden Sands Ledger — Native Authentication v1

This replaces Google OAuth with free native ledger accounts.

## Security model

- Login email + password
- Passwords are never stored directly
- Passwords are PBKDF2-HMAC-SHA-256 derived with a unique random salt
- 210,000 PBKDF2 iterations
- D1 stores only salt + derived hash + iteration count
- Login sessions use random tokens
- Only a SHA-256 hash of each session token is stored in D1
- Browser session cookie is Secure + HttpOnly + SameSite=Lax
- Worker enforces business permissions server-side

## IMPORTANT

Authentication starts with:

AUTH_ENFORCE=false

so you cannot lock yourself out while setting up the owner account.

## STEP 1 — Run migration

npx wrangler d1 execute golden-sands-ledger --remote --file=./native-auth-migration.sql

## STEP 2 — Add the setup token as a Cloudflare secret

Run:

npx wrangler secret put AUTH_SETUP_TOKEN

When prompted, paste the value from OWNER-SETUP-TOKEN.txt.

DO NOT upload or commit OWNER-SETUP-TOKEN.txt to GitHub.

## STEP 3 — Copy package files to repo

Do not copy OWNER-SETUP-TOKEN.txt into GitHub.

Commit/push the app files. Authentication remains optional.

## STEP 4 — Create owner password

After deployment, we will use the protected one-time owner setup endpoint.
The setup token is required.

## STEP 5 — Test owner login

Once owner login works, change wrangler.jsonc:

AUTH_ENFORCE = "true"
AUTH_SETUP_ENABLED = "false"

Commit/push.

After that, unauthenticated users cannot use the ledger API.

## Employee accounts

Owner/admin can create an employee with:
- name
- login email
- temporary password
- role

and then assign each business and its permissions.

The owner can reset an employee password. Reset passwords are marked as
temporary so the employee can be told to change it after login.
