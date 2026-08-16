# Golden Sands Ledger — Cloudflare Worker + D1 Package

This package restructures the current ledger for Cloudflare Workers Static Assets.

## Repository structure

public/
  index.html
  styles.css
  app.js

src/
  index.js

wrangler.jsonc

## Included setup

- Existing ledger frontend in `public/`
- Worker entry point at `src/index.js`
- D1 binding exposed as `env.DB`
- Static asset binding exposed as `env.ASSETS`
- `/api/health` database connectivity test

## D1 binding

Binding: DB
Database: golden-sands-ledger
Database ID: fcb10916-a09c-477a-b5e3-03e904116718

## Upload

Replace the current repository contents with the contents of this package while preserving the folders.

After the commit, Cloudflare should run:

npx wrangler deploy

If deployment succeeds, visit your Worker URL followed by:

/api/health

Expected result:

{
  "worker": true,
  "database": true
}

The frontend still uses localStorage at this stage. The next phase will create the D1 tables and move shared ledger data to the backend.
