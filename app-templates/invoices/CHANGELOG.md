# Changelog

## 1.0.0

- First release as a marketplace app template (moved from the Flock repo).
- New invoice lines default to no tax for an unregistered seller (18% when the seller has a GSTIN).
- The business identity (name, GSTIN, address, email, payment details) starts empty instead of the sample studio, and an empty value is valid. A real invoice cannot be issued while the company name is empty (the route answers `business_name_missing`; the page says "Add your company name in Settings before issuing" with an Open settings button); drafts can still be made and edited and print "Your company name" in its place. Sample invoices keep the sample seller as issued. New Settings page for the company details.
