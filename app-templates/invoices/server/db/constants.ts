// Plain constants, no imports: the server schema, the totals maths and the browser pages all read these.

/** "1 customer", "4 customers", "20+ customers": the noun agrees with the count, and a "+" (more than shown) is always plural. */
export const countText = (n: number, more: boolean, one: string, many: string): string => `${n}${more ? "+" : ""} ${n === 1 && !more ? one : many}`;

/** Stored statuses. "overdue" is never stored by hand: an invoice is overdue when it is sent, unpaid and past its due date. */
export const STATUSES = ["draft", "sent", "paid", "overdue", "void"] as const;
/** GST slabs offered on a line: the slabs since 22 Sep 2025. The editor also takes a custom % (0-100, two decimals),
 *  such as 3 for gold. A line stored at an older rate (12, 28) keeps it; rates are never re-mapped. */
export const GST_RATES = [0, 5, 18, 40] as const;
export const METHODS = ["upi", "bank", "cash", "card"] as const;
/** Today's defaults for the business issuing the invoices. The owner's values are the app settings `business.*` (GET /api/_app,
 *  PATCH /api/_app/settings); always read them through the settings, never these. */
export const BUSINESS = {
  name: "Brindavan Design Studio",
  gstin: "29AAEPB4172K1ZB",
  address: "14, 2nd Cross, Indiranagar, Bengaluru 560038",
  email: "billing@brindavan.example",
  /** Where payments go, printed at the foot of the invoice. */
  pay: "UPI brindavan@okaxis · HDFC Bank A/c 50200041872233 · IFSC HDFC0000412",
} as const;
/** Default two-digit GST state code of the business (29 = Karnataka): the setting `seller_state`. A customer whose GSTIN starts with
 *  another code is billed IGST, otherwise CGST + SGST. */
export const SELLER_STATE = "29";
/** Default start of invoice numbers (INV-2026-0042): the setting `number_prefix`. */
export const NUMBER_PREFIX = "INV";

/** What the helpers read: the app's current settings, shaped. */
export interface Business { name: string; gstin: string; address: string; email: string; pay: string }
export interface InvoiceSettings { business: Business; seller_state: string; number_prefix: string }
export const DEFAULT_SETTINGS: InvoiceSettings = { business: { ...BUSINESS }, seller_state: SELLER_STATE, number_prefix: NUMBER_PREFIX };

/** The business fields (name, GSTIN, address, payment details) that are still the template's sample. Any one of them would print
 *  Brindavan's details under the owner's name, so the pages say so until every one is set. */
export const sampleBusinessFields = (s: Pick<InvoiceSettings, "business">): string[] =>
  (["name", "gstin", "address", "pay"] as const).filter((k) => s.business[k] === BUSINESS[k]);
export const usesSampleBusiness = (s: Pick<InvoiceSettings, "business">): boolean => sampleBusinessFields(s).length > 0;

/** Why `v` is not a GST state code a business can be in (01 to 38, or 97 for Other Territory), or null when it is. */
export const sellerStateProblem = (v: unknown): string | null => {
  const ok = typeof v === "string" && /^\d{2}$/.test(v) && ((Number(v) >= 1 && Number(v) <= 38) || v === "97");
  return ok ? null : "seller_state must be a two-digit GST state code, 01 to 38 or 97 (29 is Karnataka)";
};
/** Why `v` is not a GSTIN in shape (or empty, for an unregistered business), or null when it is. The portal is never asked. */
export const gstinProblem = (v: unknown): string | null =>
  typeof v === "string" && (v === "" || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v)) ? null
    : "business.gstin must be 15 characters like 29AAEPB4172K1ZB (capitals), or empty when not registered";
/** "KS-" and "KS " are how people write the prefix of KS-2026-0042: a trailing dash or space is dropped, so they mean "KS". */
export const normalPrefix = (v: string): string => v.replace(/[-\s]+$/, "");
/** Why `v` is not a usable number prefix, or null when it is. GST Rule 46(b) allows letters, digits, "-" and "/" in a serial; the
 *  number adds its own dashes, so the prefix takes letters, digits and "/" (not first), six at most, so PREFIX-2026-0042 stays within 16. */
export const numberPrefixProblem = (v: unknown): string | null =>
  typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9/]{0,5}$/.test(normalPrefix(v)) ? null
    : "number_prefix must be 1 to 6 letters or digits (\"/\" allowed after the first), with no spaces, dashes or other marks (a trailing dash or space is dropped)";
const nameProblem = (key: string) => (v: unknown): string | null => (typeof v === "string" && v.trim() ? null : `${key} must not be empty`);
const textProblem = (key: string) => (v: unknown): string | null => (typeof v === "string" ? null : `${key} must be text`);

/** The settings this template declares (passed to mountKit, and listed in template.json without the checks). Defaults are today's constants.
 *  The kit runs each `check` on PATCH /api/_app/settings (400 naming the field), on the boot import (the import fails) and on read. */
/** An issued invoice keeps a copy of the seller for good (bill-to.ts), so an import with sent, paid, overdue or void invoices must give
 *  every setting that copy takes: left to the defaults, it would freeze the sample business, its GSTIN and its bank details. */
const ISSUED = { table: "invoices", column: "status", in: ["sent", "paid", "overdue", "void"], rows: "an issued invoice" };
export const SETTINGS = [
  { key: "business.name", type: "string" as const, default: BUSINESS.name, scope: "owner" as const, label: "Your business name, printed at the top of every invoice", check: nameProblem("business.name"), requiredWhen: ISSUED },
  { key: "business.gstin", type: "string" as const, default: BUSINESS.gstin, scope: "owner" as const, label: "Your GSTIN (15 characters), or empty when the business is not registered for GST", check: gstinProblem, requiredWhen: ISSUED },
  { key: "business.address", type: "string" as const, default: BUSINESS.address, scope: "owner" as const, label: "Your business address, printed under the name", check: textProblem("business.address"), requiredWhen: ISSUED },
  { key: "business.email", type: "string" as const, default: BUSINESS.email, scope: "owner" as const, label: "The email address printed on invoices", check: textProblem("business.email"), requiredWhen: ISSUED },
  { key: "business.pay", type: "string" as const, default: BUSINESS.pay, scope: "owner" as const, label: "Where customers pay you (UPI id, bank account and IFSC), printed at the foot of every invoice", check: textProblem("business.pay"), requiredWhen: ISSUED },
  { key: "seller_state", type: "string" as const, default: SELLER_STATE, scope: "owner" as const, label: "Your two-digit GST state code (29 = Karnataka): a customer with a GSTIN from another state is billed IGST", check: sellerStateProblem, requiredWhen: ISSUED },
  { key: "number_prefix", type: "string" as const, default: NUMBER_PREFIX, scope: "owner" as const, label: "The start of new invoice numbers: 1 to 6 letters or digits, \"/\" allowed after the first (INV gives INV-2026-0042); issued numbers never change", check: numberPrefixProblem },
];

const checkOf = new Map(SETTINGS.map((d) => [d.key, d.check]));

/** The kit's flat settings (`kit.settings.all()`, or `settings` from GET /api/_app) as the helpers use them. A stored value that does
 *  not pass its check falls back to its default, so a bad state code never decides IGST and a bad prefix never makes a number. */
export function invoiceSettings(raw: Record<string, unknown>): InvoiceSettings {
  const pick = (key: string, fallback: string): string => (key in raw && checkOf.get(key)!(raw[key]) === null ? raw[key] as string : fallback);
  const b = DEFAULT_SETTINGS.business;
  return {
    business: { name: pick("business.name", b.name), gstin: pick("business.gstin", b.gstin), address: pick("business.address", b.address), email: pick("business.email", b.email), pay: pick("business.pay", b.pay) },
    seller_state: pick("seller_state", SELLER_STATE),
    number_prefix: normalPrefix(pick("number_prefix", NUMBER_PREFIX)),
  };
}
