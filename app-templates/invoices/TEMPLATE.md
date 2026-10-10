# Invoices

For a small business that bills customers with GST: invoices with line items, who has paid, who is late.
Start here when the owner says "invoices", "bill my clients", "GST invoice", "who hasn't paid" or "send a payment reminder".

## Data
Four tables (server/db/schema.ts), each with the kit's `id`, `created_at`, `updated_at`, `updated_by`. Money is rupees (decimals allowed, rounded to paise).
- `customers`: `name`, `gstin` (optional, 15 characters), `email`, `phone`, `address`.
- `invoices`: `number` (unique, like `INV-2026-0042`), `customer_id`, `issue_date`, `due_date` (ISO dates), `status`, `notes`, `bill_to`, `seller`.
- `bill_to` is the app's copy of the customer as billed (name, address, GSTIN, place of supply, IGST or not), taken by the server the moment an invoice leaves `draft`. An issued invoice is printed and taxed from this copy, so editing or deleting the customer never rewrites it; a draft follows the live customer. Never write `bill_to` by hand: the server drops one sent with a POST or PATCH. Undo does not bring an old copy back: undoing an earlier move to another customer (or undoing "Mark as sent" and sending again) takes a fresh copy from the customer as they are at that moment.
- `seller` is the app's copy of the business as it issued the invoice (name, GSTIN, address, email, payment details, state code), taken from the settings the moment an invoice leaves `draft`. Changing the settings later never rewrites an issued invoice; a draft shows the settings as they are now. Never write `seller` by hand: the server drops it like `bill_to`. Back to `draft` (only through an Undo of "Mark as sent") drops both copies, and issuing again takes fresh ones.
- `customer_id` and `invoice_id` are declared links (`.references()`): metadata only (foreign keys are off), used by the boot import's `$ref` and by Clear samples.
- `invoice_lines`: `invoice_id`, `description`, `qty`, `unit_price` (before GST), `gst_rate` (percent: 0, 5, 18 or 40, the slabs since 22 Sep 2025, or a custom rate from 0 to 100 with at most two decimals, such as 3 for gold). A line stored at an older rate (12, 28) keeps it and is taxed at it; never re-map stored rates.
- `payments`: `invoice_id`, `date`, `amount`, `method` (`upi`, `bank`, `cash` or `card`), `ref` (UTR or cheque number).

Totals are never stored. `server/db/invoice-math.ts` is the one place they are worked out: the server routes and the browser both import it.
- Tax is worked out per GST slab on the taxable total. A customer whose GSTIN starts with a different state code than the `seller_state` setting is billed IGST; everyone else (same state, or no GSTIN) gets CGST + SGST halves.
- Status is derived. `draft` and `void` are stored. An invoice that is `sent` is shown as `paid` once the payments cover the total, and as `overdue` once the due date is past and money is still owed. A hand-written `overdue` or `paid` status does not stick: record the payment instead.

## Settings: your business
These are app settings, not code. `GET /api/_app` shows them under `settings`; change them with `PATCH /api/_app/settings` (needs the owner's or an agent's identity header), for example `{"business.name": "Asha Tuition Centre", "seller_state": "32"}`.
An import (or a planned app) whose rows include a sent, paid, overdue or void invoice must give every `business.*` setting and `seller_state` (`""` for one the owner does not have): an issued invoice keeps them for good, and the defaults are the sample business. The kit refuses such an import otherwise.
- `business.name` (not empty), `business.address`, `business.email`, `business.pay` (UPI id, bank account and IFSC, printed at the foot): printed on every invoice.
- `business.gstin`: 15 characters like `29AAEPB4172K1ZB` in capitals, or `""` when the business is not registered. Checked for shape only. **An unregistered seller cannot collect GST:** with an empty GSTIN the invoice carries no tax at all (tax 0, total = subtotal, no CGST/SGST/IGST rows, no rate column on screen or in print, the editor hides the rate pickers), and the sheet is titled "Invoice", not "Tax invoice". The lines keep their stored `gst_rate`. An issued invoice keeps the registration it was issued under (its `seller` copy); a draft follows the setting. `/api/invoice/<id>` says so in `gst_registered`, and every total the routes give already leaves the tax out.
- `seller_state`: the business's two-digit GST state code, `01` to `38` or `97` (29 is Karnataka). It decides CGST + SGST versus IGST. Keep it the same as the first two digits of `business.gstin`; nothing checks that the two agree.
- `number_prefix`: 1 to 6 letters or digits, with `/` allowed after the first (GST Rule 46(b); the number adds its own dashes, and 6 keeps `PREFIX-2026-0042` within the 16 characters allowed). No spaces, dashes or other marks. A new prefix numbers new invoices only (`KS-2026-0001` onwards); issued numbers never change. Past 9,999 invoices in a year the number grows a digit, so keep the prefix short if that is likely.
- A bad value answers `400` naming the `field`, and nothing changes; a boot import with a bad value fails. The defaults and checks live in `SETTINGS` in server/db/constants.ts, which template.json repeats (without the checks).

## Pages
- `Invoices`: money strip (outstanding, overdue, paid this month), search, a Status filter and the list with load more. Opening a row shows the invoice.
- Invoice: the printable document (your details, the customer, lines, CGST/SGST or IGST, total, received, balance due), then Payments. Buttons: Edit (drafts only), Mark as sent, Record payment, Void, Delete (drafts only, asks first, with Undo; an issued invoice is voided so its number is never reused), Print / Save as PDF.
- New invoice and Edit use the `LineItems` component: add, change and remove lines with live totals. Saving an edit that removed lines offers Undo, which brings them back.
- `Customers` (its name and the word customer follow the labels `noun.one` / `noun.many`, so a tuition app can say student / students; set both, and the nav and title follow unless `nav.customers` / `title.customers` are set): search, add, edit, delete (asks first, with Undo). A GSTIN is checked for shape only, not against the GST portal.
- Print / Save as PDF uses the browser's print dialog; the stylesheet in src/App.css prints only the invoice sheet on A4. Choose "Save as PDF" as the printer.
- The agent chat sits beside the page; the invoice or customer last opened is sent as its context.

## For an agent
Read rows through `/api/_data/<table>`; the app's own routes add up the money (pass the viewer's date as `today=YYYY-MM-DD`):
- `GET /api/invoice-list?status=overdue&today=2026-10-09` gives each invoice with `total`, `paid`, `balance`, `days_overdue` and the derived `status`. Also `q=` (number or customer name), `limit=`, `cursor=`.
- `GET /api/invoice/<id>?today=...` gives the invoice, `seller` (as issued, or the live settings for a draft), customer as billed (with the live `email` and `phone`), `place_of_supply`, lines, payments and the totals rows.
- `GET /api/invoice-summary?today=...` gives `outstanding`, `overdue`, `paid_this_month`.
- `GET /api/next-number` gives the next free invoice number.

To chase what is overdue: list `status=overdue`, read each invoice and its customer, and draft a short, polite reminder that names the invoice number, the balance and the due date. Show the draft in chat and wait for the owner's plain "yes" before anything is sent. This app has no way to send email or messages itself, so never claim a reminder went out; the owner (or an email agent they approve) sends it.
Delete only drafts: `DELETE /api/_data/invoices/<id>` on a sent, paid or void invoice answers 409 `issued`; void it instead (`PATCH` `status: "void"`), so its number is never reused.
An issued invoice is a record: a `PATCH` may change only its `status` (on to paid, back to sent when a payment is removed, or to void; never back to `draft`, and a void invoice stays void) and its `notes`. Its number, customer, dates and lines are fixed: any other change, and any `invoice_lines` write on it, answers 409 `issued`. To correct one, void it and issue a new invoice.
Create an invoice by POSTing the `invoices` row (status `draft`, a fresh number from `next-number`) and then one `invoice_lines` row per line. Record a payment by POSTing to `payments`; when it covers the balance also PATCH the invoice to `status: "paid"` so raw rows agree with the screen.

## Writing rows directly
`/api/_data` checks types, not business rules: it does not check that `gst_rate` is one of 0, 5, 18, 40 (or a deliberate custom rate) or that `status` is one of the listed values. An invoice with another rate is taxed at that rate; an unknown status is treated as `sent`. Agents must use exactly the listed values, and a custom GST rate only when the owner names it. A duplicate invoice `number` answers 409 with `field: "number"`.

## What to change first
1. Your business: the `business.*`, `seller_state` and `number_prefix` settings (`PATCH /api/_app/settings`), no code change needed. They are printed on every invoice and decide CGST/SGST versus IGST.
2. The sample rows in server/db/seed.ts: replace them with the owner's real customers and invoices (or delete the invoices and keep the customers).
3. The page titles and nav names (each `label("title.<page>", …)` and `label("nav.<page>", …)`), the starter prompts in src/App.tsx and the accent (a name, one of coral, teal, blue, green, violet, amber; never a hex colour).
4. The objects are `receipt` and `handshake` (find others with find-object.sh).

## Limits
- **Keep this app private.** It holds customer data; do not make it public until Flock supports public write rules (today a public app lets any visitor read and change its data).
- Not a GST filing tool: it does not produce GSTR returns, e-invoices (IRN / QR) or e-way bills, and it does not check a GSTIN against the portal.
- One currency (INR), one tax regime (GST), no HSN/SAC column, no discounts or TDS lines; add them as columns on `invoice_lines` before the app has real rows.
- Renaming a column or table needs the owner's approval, so settle the shape before real data goes in.
- The list and totals read every invoice each time; that is fine for thousands of invoices, not for hundreds of thousands.
- Tax is rounded to the paise per slab, with CGST and SGST always equal. Rounding the total to the whole rupee (a "round off" line) is not built in; add a line at 0% GST if the owner wants one (the editor takes only prices of zero or more; a negative round-off is written through `/api/_data`).
- Email and phone are not copied: an issued invoice shows the customer's current contact details. The edit form shows the live customer, so after changing a customer's GSTIN the form's IGST/CGST note can differ from the issued copy; an issued invoice cannot be edited, so its copy stays.
- Saving an edited invoice is several writes (the invoice, then each changed line). If the connection drops half-way, the invoice can be saved with some lines not yet updated; open it again and save.
- Deleting an invoice leaves its lines and payments in place (so Undo restores everything); they are not shown anywhere without it.

## Name, accent, starters and labels
The app reads them at run time with `useApp()` from `display` in flock.app.json (`object`, `accent`, `starters`, `labels`), served at `/api/_app`;
the name is the app's registered name. What App.tsx passes after `??`, and the second argument of each `label(key, fallback)`, are only fallbacks:
when `display` sets a value, change it there, or the change in code never shows.

## Design updates
`src/flock/` (ui, theme, COMPONENTS.md, CHANGELOG.md, VERSION) belongs to the component library and is overwritten by `update-design.sh`.
Put the app's own CSS (such as the print rules) outside it, in `src/App.css`. App-only objects in `src/flock/objects/` are kept.
