import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { SETTINGS, BUSINESS, SAMPLE_BUSINESS, NAME_PLACEHOLDER, SELLER_STATE, NUMBER_PREFIX } from "../server/db/constants";

// template.json is never copied into an app, so the server declares its settings from constants.ts; the plan and the catalogue read
// template.json. The two lists must be the same.
describe("invoices settings", () => {
  it("template.json lists exactly the settings the server declares to mountKit, with today's defaults", () => {
    const meta = JSON.parse(readFileSync(join(import.meta.dir, "..", "template.json"), "utf8"));
    // `rules` (the declarative twin of a check) live in settings.json, not template.json
    expect(meta.settings).toEqual(JSON.parse(JSON.stringify(SETTINGS)).map(({ rules: _r, ...d }: Record<string, unknown>) => d));
    expect(meta.settings.map((s: { key: string }) => s.key)).toEqual(
      ["business.name", "business.gstin", "business.address", "business.email", "business.pay", "seller_state", "number_prefix"]);
    const def = (k: string) => meta.settings.find((s: { key: string }) => s.key === k).default;
    expect(def("business.name")).toBe(BUSINESS.name);
    expect(def("business.pay")).toBe(BUSINESS.pay);
    expect(def("seller_state")).toBe(SELLER_STATE);
    expect(def("number_prefix")).toBe(NUMBER_PREFIX);
    expect(meta.settings.every((s: { type: string; scope: string }) => s.type === "string" && s.scope === "owner")).toBe(true);
  });
});

describe("the sample business notice", () => {
  it("is off for the empty defaults; an app that stored the sample details keeps it until each is replaced", async () => {
    const { usesSampleBusiness, sampleBusinessFields, invoiceSettings, DEFAULT_SETTINGS, SAMPLE_BUSINESS: S } = await import("../server/db/constants");
    expect(usesSampleBusiness(DEFAULT_SETTINGS)).toBe(false);
    const stored = { "business.name": S.name, "business.gstin": S.gstin, "business.address": S.address, "business.pay": S.pay };
    expect(usesSampleBusiness(invoiceSettings(stored))).toBe(true);
    // only the name replaced: GSTIN, address and bank details are still Brindavan's, so the notice stays
    expect(sampleBusinessFields(invoiceSettings({ ...stored, "business.name": "Acme Tiles" }))).toEqual(["gstin", "address", "pay"]);
    expect(usesSampleBusiness(invoiceSettings({ "business.name": "Acme", "business.gstin": "", "business.address": "1 Road", "business.pay": "UPI acme@upi" }))).toBe(false);
  });
  it("the list and a draft show it", () => {
    const pages = join(import.meta.dir, "..", "src", "pages");
    expect(readFileSync(join(pages, "InvoicesPage.tsx"), "utf8")).toContain("<SampleBusinessNotice />");
    expect(readFileSync(join(pages, "InvoicePage.tsx"), "utf8")).toContain("<SampleBusinessNotice />");
  });
});

describe("new invoice lines follow the seller's registration", () => {
  it("defaults to 18% when registered and no tax when the seller has no GSTIN", async () => {
    const { defaultGstRate } = await import("../server/db/constants");
    expect(defaultGstRate(true)).toBe(18);
    expect(defaultGstRate(false)).toBe(0);
  });
  it("retargets only untouched blank lines; started and saved lines keep their rate", async () => {
    const { followRegistration } = await import("../server/db/constants");
    const blank = { description: "", qty: 1, unit_price: null, gst_rate: 18 };
    const started = { description: "Shoot", qty: 1, unit_price: null, gst_rate: 18 };
    const priced = { description: "", qty: 1, unit_price: 500, gst_rate: 18 };
    const saved = { id: "l1", description: "", qty: 1, unit_price: null, gst_rate: 18 };
    expect(followRegistration([blank, started, priced, saved], false)).toEqual([{ ...blank, gst_rate: 0 }, started, priced, saved]);
    expect(followRegistration([{ ...blank, gst_rate: 0 }], true)).toEqual([blank]);
  });
  it("the editor starts its first line from the registration, and re-follows when the settings load", () => {
    const src = readFileSync(join(import.meta.dir, "..", "src", "pages", "InvoiceEditor.tsx"), "utf8");
    expect(src).toContain("followRegistration(");
    expect(src).not.toContain("gst_rate: 18 }");
  });
});

describe("a missing company name", () => {
  const src = (f: string) => readFileSync(join(import.meta.dir, "..", "src", "pages", f), "utf8");
  it("no business setting defaults to sample data; the sample identity is its own constant", () => {
    expect(Object.values(BUSINESS).every((v) => v === "")).toBe(true);
    expect(SAMPLE_BUSINESS.name).toBe("Brindavan Design Studio");
    const meta = JSON.parse(readFileSync(join(import.meta.dir, "..", "template.json"), "utf8"));
    for (const s of meta.settings.filter((x: { key: string }) => x.key.startsWith("business."))) expect(s.default).toBe("");
    expect(JSON.parse(readFileSync(join(import.meta.dir, "..", "template.json"), "utf8"))).not.toHaveProperty("brindavan");
    expect(readFileSync(join(import.meta.dir, "..", "template.json"), "utf8")).not.toContain("Brindavan");
  });
  it("settings.json no longer demands a non-empty name", () => {
    const s = JSON.parse(readFileSync(join(import.meta.dir, "..", "settings.json"), "utf8"));
    expect(s["business.name"].rules).toBeUndefined();
  });
  it("the UI refuses to issue without a name, offers settings, and prints a placeholder for a draft", () => {
    const page = src("InvoicePage.tsx");
    expect(page).toContain("Add your company name in Settings before issuing");
    expect(page).toContain("NAME_PLACEHOLDER");
    expect(NAME_PLACEHOLDER).toBe("Your company name");
    expect(src("SampleBusinessNotice.tsx")).toContain("Add your company name in Settings before issuing");
    expect(readFileSync(join(import.meta.dir, "..", "src", "App.tsx"), "utf8")).toContain("settings");
  });
});
