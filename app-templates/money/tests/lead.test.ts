import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { overviewLead, leadSetting } from "../src/pages/lead";
import { SETTINGS, overviewLeadProblem } from "../server/db/constants";

const month = { income: 0, expenses: 3800 };
describe("money overview lead", () => {
  it("auto: no real holdings (only the samples, which the page does not count) leads with spending", () => {
    expect(overviewLead(0, month, "auto")).toEqual({ hero: "spending", strip: [] });
  });
  it("auto: keeps the strip's income and saved when income is recorded", () => {
    expect(overviewLead(0, { ...month, income: 50000 }, "auto")).toEqual({ hero: "spending", strip: ["income", "saved"] });
  });
  it("auto: real holdings lead with net worth and the full strip", () => {
    expect(overviewLead(3, { ...month, income: 50000 }, "auto")).toEqual({ hero: "netWorth", strip: ["income", "spent", "saved"] });
  });
  it("auto is the default, and without month data there is no strip", () => {
    expect(overviewLead(2, undefined)).toEqual({ hero: "netWorth", strip: [] });
    expect(overviewLead(0, undefined)).toEqual({ hero: "spending", strip: [] });
  });
  it("the setting overrides both ways", () => {
    expect(overviewLead(5, month, "spending").hero).toBe("spending");
    expect(overviewLead(0, month, "netWorth").hero).toBe("netWorth");
  });
  it("an unusable stored value is auto", () => {
    expect(leadSetting("spending")).toBe("spending");
    expect(leadSetting("netWorth")).toBe("netWorth");
    expect(leadSetting("bogus")).toBe("auto");
    expect(leadSetting(undefined)).toBe("auto");
  });
});

describe("overviewLead setting", () => {
  it("is declared to the kit and repeated in template.json, default auto", () => {
    const meta = JSON.parse(readFileSync(join(import.meta.dir, "..", "template.json"), "utf8"));
    expect(meta.settings).toEqual(JSON.parse(JSON.stringify(SETTINGS)).map(({ rules: _r, ...d }: Record<string, unknown>) => d));
    const s = SETTINGS.find((d) => d.key === "overviewLead")!;
    expect(s.default).toBe("auto");
    expect(s.label).toMatch(/spending/);
    expect(s.label).toMatch(/netWorth/);
  });
  it("accepts the three values and refuses others", () => {
    for (const v of ["auto", "spending", "netWorth"]) expect(overviewLeadProblem(v)).toBeNull();
    expect(overviewLeadProblem("wealth")).not.toBeNull();
    expect(overviewLeadProblem(1)).not.toBeNull();
  });
});
