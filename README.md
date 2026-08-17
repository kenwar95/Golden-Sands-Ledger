# Golden Sands Ledger — Shared Operations v2

This phase makes the existing Transfers, Notebook, Register/Sales History,
Employee Earnings, and sale-related Coffers shared through D1.

Apply first:
npx wrangler d1 execute golden-sands-ledger --remote --file=./ops-migration.sql

Then commit and push this package.

Test with normal + Incognito:
- write a notebook note in one window and refresh the other
- make a small transfer and verify both inventories
- make a small sale and verify shared history/earnings/coffers
