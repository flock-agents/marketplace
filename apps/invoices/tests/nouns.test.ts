import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { nounsFrom, singular } from "../src/pages/nouns";

const labels = (o: Partial<{ one: string; many: string; title: string; nav: string }>) => ({ one: "customer", many: "customers", title: "Customers", nav: "Customers", ...o });
describe("invoices: what the billed people are called (L10)", () => {
  it("defaults to customer / customers", () => expect(nounsFrom(labels({}))).toEqual({ one: "customer", many: "customers" }));
  it("noun.one and noun.many win", () => expect(nounsFrom(labels({ one: "student", many: "students", title: "Clients" }))).toEqual({ one: "student", many: "students" }));
  it("follows a renamed tab when the nouns were not set", () => {
    expect(nounsFrom(labels({ title: "Clients" }))).toEqual({ one: "client", many: "clients" });
    expect(nounsFrom(labels({ nav: "Parties" }))).toEqual({ one: "party", many: "parties" });
  });
  it("singularises safely and drops a possessive prefix; the nav label beats the title", () => {
    expect(nounsFrom(labels({ nav: "Classes" }))).toEqual({ one: "class", many: "classes" });
    expect(nounsFrom(labels({ nav: "Businesses" }))).toEqual({ one: "business", many: "businesses" });
    expect(nounsFrom(labels({ title: "My Clients" }))).toEqual({ one: "client", many: "clients" });
    expect(nounsFrom(labels({ nav: "Clients", title: "Who I bill" }))).toEqual({ one: "client", many: "clients" });
  });
  it("leaves non-plural -s words and irregular -ies words right", () => {
    expect(["series", "news", "movies", "statuses", "addresses", "glasses"].map(singular)).toEqual(["series", "news", "movie", "status", "address", "glass"]);
  });
  it("an explicit noun.many alone gives a matching one", () => expect(nounsFrom(labels({ many: "students", nav: "Clients" }))).toEqual({ one: "student", many: "students" }));
  it("the invoice table header and the editor field use the shared noun", () => {
    const src = join(import.meta.dir, "..", "src", "pages");
    expect(readFileSync(join(src, "InvoicesPage.tsx"), "utf8")).toContain("label: cap(one())");
    expect(readFileSync(join(src, "shared.ts"), "utf8")).toContain("nounsFrom");
  });
});
