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
