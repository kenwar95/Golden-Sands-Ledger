# Golden Sands Ledger — Orders v1

Adds a business-scoped Orders page.

Pending order fields:
- Name
- Hold Delivery
- Estimated Time
- Employee That Received Order
- Items
  - select from current business inventory, or
  - create a custom item directly in the order
- Quantity needed per item
- Custom negotiated unit price per item

Fulfillment:
- requires enough matching inventory for the entire order
- consumes the same stock batches used by the Register
- automatically detects stock / transfer contributors
- automatically includes the employee who received the order
- automatically includes the signed-in employee fulfilling the order
- allows additional participants
- deduplicates employees before splitting profit
- creates a normal completed sale / receipt history entry
- adds company cut to coffers
- adds employee payouts to earnings
- marks the order Completed and links it to its generated sale

Apply first:

npx wrangler d1 execute golden-sands-ledger --remote --file=./orders-migration.sql

Then copy the package into the repository and commit/push.
