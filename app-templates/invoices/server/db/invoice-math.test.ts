import { describe, it, expect } from "bun:test";
import { computeTotals, effectiveStatus, isInterState, nextNumber, daysOverdue } from "./invoice-math";
import { GST_RATES, DEFAULT_SETTINGS, invoiceSettings, sellerStateProblem, gstinProblem, numberPrefixProblem, type InvoiceSettings } from "./constants";
import { sampleData } from "./seed";

// 12% is no longer offered (slabs since 22 Sep 2025: 0, 5, 18, 40), but a line stored at 12% before then keeps it.
const lines = [
  { qty: 1, unit_price: 25000, gst_rate: 18 },
  { qty: 200, unit_price: 4.5, gst_rate: 12 },
];

describe("GST rates", () => {
  it("offers 0, 5, 18 and 40, and the sample uses only those", () => {
    expect([...GST_RATES]).toEqual([0, 5, 18, 40]);
    const used = new Set(sampleData(new Date(2026, 9, 9)).invoice_lines.map((l) => l.gst_rate));
    expect([...used].every((r) => (GST_RATES as readonly number[]).includes(r))).toBe(true);
  });
  it("40% is CGST 20% + SGST 20% in-state and IGST 40% between states", () => {
    const l = [{ qty: 2, unit_price: 50000, gst_rate: 40 }];
    expect(computeTotals(l, false).rows.map((r) => [r.label, r.value])).toEqual([["Subtotal", 100000], ["CGST 20%", 20000], ["SGST 20%", 20000], ["Total", 140000]]);
    expect(computeTotals(l, true).rows.map((r) => [r.label, r.value])).toEqual([["Subtotal", 100000], ["IGST 40%", 40000], ["Total", 140000]]);
  });
  it("a custom 3% (gold) is CGST 1.5% + SGST 1.5%", () => {
    expect(computeTotals([{ qty: 1, unit_price: 72000, gst_rate: 3 }], false).rows.map((r) => [r.label, r.value])).toEqual([["Subtotal", 72000], ["CGST 1.5%", 1080], ["SGST 1.5%", 1080], ["Total", 74160]]);
  });
});

describe("computeTotals", () => {
  it("splits each slab into CGST and SGST halves in-state (a stored 12% line included)", () => {
    const t = computeTotals(lines, false);
    expect(t.rows.map((r) => [r.label, r.value])).toEqual([["Subtotal", 25900], ["CGST 6%", 54], ["SGST 6%", 54], ["CGST 9%", 2250], ["SGST 9%", 2250], ["Total", 30508]]);
    expect([t.subtotal, t.tax, t.total, t.split]).toEqual([25900, 4608, 30508, "intra"]);
  });
  it("bills IGST between states, with the same total", () => {
    const t = computeTotals(lines, true);
    expect(t.rows.map((r) => r.label)).toEqual(["Subtotal", "IGST 12%", "IGST 18%", "Total"]);
    expect(t.total).toBe(30508);
  });
  it("rounds to paise and treats zero-rated and empty lines as no tax", () => {
    expect(computeTotals([{ qty: 3, unit_price: 33.33, gst_rate: 5 }], true).total).toBe(104.99);
    expect(computeTotals([{ qty: 2, unit_price: 100, gst_rate: 0 }], false).rows.map((r) => r.label)).toEqual(["Subtotal", "Total"]);
    expect(computeTotals([], false).total).toBe(0);
  });
});

describe("odd paise", () => {
  it("keeps CGST and SGST equal, so tax is exactly twice the half", () => {
    const a = computeTotals([{ qty: 3, unit_price: 1999, gst_rate: 5 }], false);
    expect(a.rows.map((r) => r.value)).toEqual([5997, 149.93, 149.93, 6296.86]);
    expect(a.tax).toBe(299.86);
    const b = computeTotals([{ qty: 1, unit_price: 100.3, gst_rate: 18 }], false);
    expect(b.rows.map((r) => r.value)).toEqual([100.3, 9.03, 9.03, 118.36]);
    expect(computeTotals([{ qty: 1, unit_price: 100.3, gst_rate: 18 }], true).rows.map((r) => r.value)).toEqual([100.3, 18.05, 118.35]);
  });
});

describe("isInterState", () => {
  it("compares the GSTIN state code with the business's", () => {
    expect(isInterState(DEFAULT_SETTINGS, "29AABCT5521M1ZP")).toBe(false);
    expect(isInterState(DEFAULT_SETTINGS, "33AAACK2284F1ZD")).toBe(true);
    expect(isInterState(DEFAULT_SETTINGS, null)).toBe(false);
    expect(isInterState(DEFAULT_SETTINGS, "")).toBe(false);
  });
});

describe("effectiveStatus", () => {
  it("keeps draft and void, derives paid, overdue and sent", () => {
    expect(effectiveStatus("draft", 100, 0, "2020-01-01", "2026-10-09")).toBe("draft");
    expect(effectiveStatus("void", 100, 0, "2020-01-01", "2026-10-09")).toBe("void");
    expect(effectiveStatus("sent", 100, 100, "2020-01-01", "2026-10-09")).toBe("paid");
    expect(effectiveStatus("sent", 100, 40, "2026-10-08", "2026-10-09")).toBe("overdue");
    expect(effectiveStatus("sent", 100, 0, "2026-10-09", "2026-10-09")).toBe("sent");     // due today is not late yet
    expect(effectiveStatus("sent", 0, 0, "2020-01-01", "2026-10-09")).toBe("paid");        // nothing owed
    expect(effectiveStatus("overdue", 100, 0, "2026-10-20", "2026-10-09")).toBe("sent");   // a hand-set overdue is ignored
    expect(effectiveStatus("paid", 100, 0, "2026-10-20", "2026-10-09")).toBe("sent");      // so is a hand-set paid without payments
  });
});

describe("nextNumber and daysOverdue", () => {
  it("continues the year's run and starts a new year at 0001", () => {
    expect(nextNumber(DEFAULT_SETTINGS, ["INV-2026-0042", "INV-2026-0007", "INV-2025-0200"], 2026)).toBe("INV-2026-0043");
    expect(nextNumber(DEFAULT_SETTINGS, ["INV-2026-0042"], 2027)).toBe("INV-2027-0001");
    expect(nextNumber(DEFAULT_SETTINGS, [], 2026)).toBe("INV-2026-0001");
  });
  it("counts whole days late", () => { expect(daysOverdue("2026-10-01", "2026-10-09")).toBe(8); expect(daysOverdue("2026-10-20", "2026-10-09")).toBe(0); });
});

describe("with the owner's settings", () => {
  // A studio in Tamil Nadu (33) with its own prefix: the same lines, the same GST maths, only the side of the state line moves.
  const chennai: InvoiceSettings = { ...DEFAULT_SETTINGS, business: { ...DEFAULT_SETTINGS.business, name: "Kanchi Studio" }, seller_state: "33", number_prefix: "KS" };
  it("judges IGST from the owner's state code, and the totals match the default seller's on the mirrored customer", () => {
    expect(isInterState(chennai, "33AAACK2284F1ZD")).toBe(false);
    expect(isInterState(chennai, "29AABCT5521M1ZP")).toBe(true);
    expect(isInterState(chennai, null)).toBe(false);   // a consumer is in-state wherever the seller is
    const intra = computeTotals(lines, isInterState(chennai, "33AAACK2284F1ZD"));
    expect(intra).toEqual(computeTotals(lines, isInterState(DEFAULT_SETTINGS, "29AABCT5521M1ZP")));
    expect(intra.rows.map((r) => [r.label, r.value])).toEqual([["Subtotal", 25900], ["CGST 6%", 54], ["SGST 6%", 54], ["CGST 9%", 2250], ["SGST 9%", 2250], ["Total", 30508]]);
    const inter = computeTotals(lines, isInterState(chennai, "29AABCT5521M1ZP"));
    expect(inter).toEqual(computeTotals(lines, isInterState(DEFAULT_SETTINGS, "33AAACK2284F1ZD")));
    expect(computeTotals([{ qty: 2, unit_price: 50000, gst_rate: 40 }], isInterState(chennai, "29AABCT5521M1ZP")).rows.map((r) => r.label)).toEqual(["Subtotal", "IGST 40%", "Total"]);
  });
  it("numbers new invoices with the owner's prefix and leaves numbers under another prefix alone", () => {
    expect(nextNumber(chennai, ["INV-2026-0042", "KS-2026-0003"], 2026)).toBe("KS-2026-0004");
    expect(nextNumber(chennai, ["INV-2026-0042"], 2026)).toBe("KS-2026-0001");
    expect(nextNumber(DEFAULT_SETTINGS, ["INV-2026-0042", "KS-2026-0003"], 2026)).toBe("INV-2026-0043");
  });
  it("takes a prefix with a slash literally, and the longest number stays within GST's 16 characters", () => {
    expect(nextNumber({ ...chennai, number_prefix: "KS/26" }, ["KS-2026-0009", "KS/26-2026-0002"], 2026)).toBe("KS/26-2026-0003");
    expect(nextNumber({ ...chennai, number_prefix: "ABC/12" }, [], 2026)).toHaveLength(16);
  });
});

describe("invoiceSettings and the checks", () => {
  it("builds the helpers' settings from the kit's flat values, falling back to the default for an unusable one", () => {
    const s = invoiceSettings({ "business.name": "Kanchi Studio", "business.gstin": "", "seller_state": "Karnataka", "number_prefix": "KS" });
    expect(s.business.name).toBe("Kanchi Studio");
    expect(s.business.gstin).toBe("");
    expect(s.business.address).toBe(DEFAULT_SETTINGS.business.address);   // not given: the default
    expect(s.seller_state).toBe("29");                                     // not a state code: the default
    expect(s.number_prefix).toBe("KS");
    expect(invoiceSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(invoiceSettings({ number_prefix: "INV 2026" }).number_prefix).toBe("INV");
    expect(invoiceSettings({ "business.name": "  " }).business.name).toBe(DEFAULT_SETTINGS.business.name);
  });
  it("checks a state code, a GSTIN and a prefix", () => {
    for (const ok of ["29", "01", "33", "38", "97"]) expect(sellerStateProblem(ok)).toBeNull();
    for (const bad of ["2", "00", "39", "99", "KA", 29, null]) expect(sellerStateProblem(bad)).toEqual(expect.any(String));
    for (const ok of ["", "29AAEPB4172K1ZB", "33AAACK2284F1ZD"]) expect(gstinProblem(ok)).toBeNull();
    for (const bad of ["29AAEPB4172K1Z", "29aaepb4172k1zb", "XXAAEPB4172K1ZB", 5]) expect(gstinProblem(bad)).toEqual(expect.any(String));
    // GST Rule 46(b): letters, digits, "-" and "/". The number adds its own dashes, so the prefix takes letters, digits and "/" only,
    // and 6 at most keeps PREFIX-2026-0042 within the 16 characters allowed.
    for (const ok of ["INV", "KS", "BDS/26", "A1"]) expect(numberPrefixProblem(ok)).toBeNull();
    for (const bad of ["", "INV 2026", "ABCDEFG", "-INV", "INV-X", "A.B", "INV_X", "/INV", 1]) expect(numberPrefixProblem(bad)).toEqual(expect.any(String));
  });
});

describe("a seller not registered for GST", () => {
  it("adds no tax: the lines keep their rates, the totals are the subtotal", () => {
    for (const inter of [false, true]) {
      const t = computeTotals(lines, inter, false);
      expect(t.rows.map((r) => [r.label, r.value])).toEqual([["Subtotal", 25900], ["Total", 25900]]);
      expect([t.subtotal, t.tax, t.total]).toEqual([25900, 0, 25900]);
    }
    expect(computeTotals(lines, false, true)).toEqual(computeTotals(lines, false));   // registered is the default
  });
});

describe("number_prefix: a trailing dash or space is dropped (L10)", () => {
  it("accepts KS- and 'KS ' as KS, and still refuses inner marks", () => {
    expect(numberPrefixProblem("KS-")).toBeNull(); expect(numberPrefixProblem("KS ")).toBeNull(); expect(numberPrefixProblem("KS/26-")).toBeNull();
    expect(numberPrefixProblem("K-S")).not.toBeNull(); expect(numberPrefixProblem("-")).not.toBeNull(); expect(numberPrefixProblem("INV 2026")).not.toBeNull();
  });
  it("reads KS- as KS, so numbers come out KS-2026-0001", () => {
    const s = invoiceSettings({ number_prefix: "KS-" });
    expect(s.number_prefix).toBe("KS"); expect(nextNumber(s, [], 2026)).toBe("KS-2026-0001");
  });
});
