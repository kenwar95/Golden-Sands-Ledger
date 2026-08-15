# Golden Sands Trading Ledger — Phase 4

Phase 4 adds business-scoped staffing and inventory provenance.

## New features

- Edit existing businesses: name, type, status, hold, location, description.
- Assign employees to specific businesses only.
- Set different permissions for each employee at each business.
- Stock intake records the employee who contributed the units.
- Inventory keeps separate contributor batches for the same item.
- Transfers preserve original contributor attribution.
- Register automatically detects stock contributors from the exact units sold.
- Seller/cashier is selected separately.
- Multiple extra participants can be manually selected.
- Receipt shows seller, stock contributors, additional participants, company cut, and split preview.
- Sales history stores participant roles.

This remains a localStorage prototype. Google login and real permission enforcement will come with Cloudflare Worker + D1.

## Phase 4.1 provenance fix

- Transfer employees are now added to the inventory batch participation chain.
- A batch can retain multiple employees across stock intake and one or more transfers.
- Checkout scans the exact batches consumed and automatically adds every unique linked employee.
- Existing Phase 4 localStorage batches are migrated automatically when the new app.js loads.

## Phase 4.1 provenance fix
- Transfer employees are appended to the stock batch participation chain.
- Multiple transfer employees remain separate and can all appear automatically on the final sale receipt.
- Existing Phase 4 local browser data is migrated forward automatically.
