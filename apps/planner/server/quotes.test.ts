import { describe, it, expect } from "bun:test";
import { bestQuote, parseQuotes, quoteProblem, upsertQuote, type Quote } from "./quotes";

const q = (service: string, total: number): Quote => ({ service, total, at: "2026-10-28T10:00:00.000Z", lines_key: "k" });

describe("quoteProblem", () => {
  it("needs a service and a grand total; fees, lines and screenshot are checked when given", () => {
    expect(quoteProblem(null)).toBe("body must be a JSON object");
    expect(quoteProblem({ total: 10 })).toBe("service is required");
    expect(quoteProblem({ service: "zepto" })).toContain("total");
    expect(quoteProblem({ service: "zepto", total: -1 })).toContain("total");
    expect(quoteProblem({ service: "zepto", total: 10, fees: { delivery: "x" } })).toContain("fees");
    expect(quoteProblem({ service: "zepto", total: 10, lines: [{ qty: 1 }] })).toContain("lines");
    expect(quoteProblem({ service: "zepto", total: 10, screenshot_url: 5 })).toContain("screenshot_url");
    expect(quoteProblem({ service: "zepto", total: 10, fees: 25, lines: [{ name: "Onion" }], screenshot_url: "https://x" })).toBeNull();
  });
});

describe("bestQuote", () => {
  const quotes = [q("zepto", 260), q("bigbasket", 240), q("zomato-blinkit", 255)];
  it("no rule → the cheapest grand total", () => {
    expect(bestQuote(quotes, null)).toEqual({ service: "bigbasket", total: 240, reason: "cheapest" });
    expect(bestQuote([], null)).toBeNull();
  });
  it("a learned service wins unless another is at least its margin cheaper", () => {
    expect(bestQuote(quotes, { service: "Zepto" })).toEqual({ service: "zepto", total: 260, reason: "learned" });
    expect(bestQuote(quotes, { service: "zepto", unless_cheaper_by: 50 })).toMatchObject({ service: "zepto" });
    expect(bestQuote(quotes, { service: "zepto", unless_cheaper_by: 20 })).toEqual({ service: "bigbasket", total: 240, reason: "cheapest" });
  });
  it("a learned service with no quote falls back to the cheapest", () => {
    expect(bestQuote(quotes, { service: "instamart" })?.service).toBe("bigbasket");
  });
});

describe("upsertQuote / parseQuotes", () => {
  it("one quote per service (any case), junk dropped", () => {
    expect(upsertQuote([q("zepto", 260), q("bigbasket", 240)], q("Zepto", 250)).map((x) => [x.service, x.total])).toEqual([["bigbasket", 240], ["Zepto", 250]]);
    expect(parseQuotes(JSON.stringify([q("zepto", 1), { service: "x" }, null]))).toHaveLength(1);
    expect(parseQuotes('{"zepto": 240}')).toEqual([]);   // the v2 {service: total} map
    expect(parseQuotes(null)).toEqual([]);
  });
});
