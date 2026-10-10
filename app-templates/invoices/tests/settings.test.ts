import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { SETTINGS, BUSINESS, SELLER_STATE, NUMBER_PREFIX } from "../server/db/constants";

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
  it("is on while the name and GSTIN are the template's, off once the owner has set either", async () => {
    const { usesSampleBusiness, invoiceSettings, DEFAULT_SETTINGS } = await import("../server/db/constants");
    expect(usesSampleBusiness(DEFAULT_SETTINGS)).toBe(true);
    // only the name set: GSTIN, address and bank details are still Brindavan's, so the notice stays
    expect(usesSampleBusiness(invoiceSettings({ "business.name": "Acme Tiles" }))).toBe(true);
    const { sampleBusinessFields } = await import("../server/db/constants");
    expect(sampleBusinessFields(invoiceSettings({ "business.name": "Acme Tiles" }))).toEqual(["gstin", "address", "pay"]);
    expect(usesSampleBusiness(invoiceSettings({ "business.name": "Acme", "business.gstin": "", "business.address": "1 Road", "business.pay": "UPI acme@upi" }))).toBe(false);
  });
  it("the list and a draft show it", () => {
    const pages = join(import.meta.dir, "..", "src", "pages");
    expect(readFileSync(join(pages, "InvoicesPage.tsx"), "utf8")).toContain("<SampleBusinessNotice />");
    expect(readFileSync(join(pages, "InvoicePage.tsx"), "utf8")).toContain("<SampleBusinessNotice />");
  });
});
