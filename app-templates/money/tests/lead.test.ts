import { describe, it, expect } from "bun:test";
import { overviewLead } from "../src/pages/lead";

const month = { month: "2026-10", income: 0, expenses: 3800, invested: 0 };
describe("money overview lead", () => {
  it("leads with spending when there are no holdings (a budget or running-costs use)", () => {
    expect(overviewLead(0, month)).toEqual({ hero: "spending", strip: [] });
  });
  it("keeps the strip's income and saved when income is recorded", () => {
    expect(overviewLead(0, { ...month, income: 50000 })).toEqual({ hero: "spending", strip: ["income", "saved"] });
  });
  it("leads with net worth once holdings exist, with the full strip", () => {
    expect(overviewLead(3, { ...month, income: 50000 })).toEqual({ hero: "netWorth", strip: ["income", "spent", "saved"] });
  });
  it("net worth without any month data still leads with net worth, no strip", () => {
    expect(overviewLead(2, undefined)).toEqual({ hero: "netWorth", strip: [] });
  });
  it("no holdings and no month data yet: spending hero, no strip", () => {
    expect(overviewLead(0, undefined)).toEqual({ hero: "spending", strip: [] });
  });
});
