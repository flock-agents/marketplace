# Changelog

## 1.1.0

- Published as a marketplace app: `flock.app.json` carries what `template.json` did plus `assemble: true` and `useCases`; `ARCHITECTURE.md` (shared kit architecture, then this app's own notes) replaces `TEMPLATE.md`, which stays as a pointer for one release. `template.json` is kept, identical in the shared fields, until the Flock tooling reads `flock.app.json`. Needs Flock 0.15.0.

## 1.0.1

- Editors open in place: a picked customer opens under its row (it opened above the list); Add opens right under the page header. On an invoice, the top Record payment opens the payment form right under that button, and the Payments card's own button opens it in the card. Escape closes them. Needs the Flock component library 1.3.0 (`expanded`, `InlinePanel`).

## 1.0.0

- First release as a marketplace app template (moved from the Flock repo).
- New invoice lines default to no tax for an unregistered seller (18% when the seller has a GSTIN).
- The business identity (name, GSTIN, address, email, payment details) starts empty instead of the sample studio, and an empty value is valid. A real invoice cannot be issued while the company name is empty (the route answers `business_name_missing`; the page says "Add your company name in Settings before issuing" with an Open settings button); drafts can still be made and edited and print "Your company name" in its place. Sample invoices keep the sample seller as issued. New Settings page for the company details.
