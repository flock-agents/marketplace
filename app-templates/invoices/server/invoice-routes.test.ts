import { describe, it, expect, setSystemTime, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { mountKit, kitColumns } from "@flock/app-kit";
import { sqliteTable, text, real } from "drizzle-orm/sqlite-core";
import * as schema from "./db/schema";
import { customers, invoices, invoice_lines, payments } from "./db/schema";
import { watchIssued } from "./bill-to";
import { mountInvoiceRoutes, enrichInvoices, guardInvoiceWrites, SERVER_COLUMNS } from "./invoice-routes";
import { sampleData, seed, inDays } from "./db/seed";
import { SETTINGS, BUSINESS, SAMPLE_BUSINESS, DEFAULT_SETTINGS, invoiceSettings } from "./db/constants";

const TODAY = "2026-10-09";
/** The settings of an owner who has set the sample studio's details as their own (the default for these tests; see `boot`). */
const OWNER = { ...DEFAULT_SETTINGS, business: { ...SAMPLE_BUSINESS } };
/** `blank`: a new app whose owner has set nothing. Otherwise the owner has set the sample studio's details as their own, so the older tests judge issuing. */
async function boot(withSeed: boolean | Date = false, importFile?: unknown, blank = false) {
  const hono = new Hono();
  const dataDir = mkdtempSync(join(tmpdir(), "invoice-routes-"));
  if (importFile) { mkdirSync(join(dataDir, ".flock"), { recursive: true }); writeFileSync(join(dataDir, ".flock", "import.json"), JSON.stringify(importFile)); }
  let db: any = null;
  let settings: any = null;
  guardInvoiceWrites(hono, () => db, () => settings);   // registered before the kit's routes, as in server/index.ts
  const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } }, { schema, dbFile: ":memory:", appName: "T", serverColumns: SERVER_COLUMNS, settings: SETTINGS, ...(withSeed ? { seed: (db: any) => seed(db, withSeed === true ? undefined : withSeed) } : {}) });
  db = kit.db; settings = kit.settings;
  mountInvoiceRoutes(hono, kit.db, kit.settings, kit.ctx.events, kit.status);
  if (!blank && kit.status.state === "ok") await hono.request("/api/_app/settings", { method: "PATCH", headers: { "Content-Type": "application/json", "X-Flock-User": "maya" }, body: JSON.stringify(Object.fromEntries(Object.entries(SAMPLE_BUSINESS).map(([k, v]) => [`business.${k}`, v]))) });
  return { hono, db: kit.db, kit };
}
const get = async (hono: Hono, path: string) => { const r = await hono.request(path); return { status: r.status, body: (await r.json()) as any }; };
const send = async (hono: Hono, method: string, path: string, body?: unknown) => {
  const r = await hono.request(path, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: (await r.json()) as any };
};

const undo = (hono: Hono, changeId: string) => hono.request(`/api/_data/_changes/${changeId}/undo`, { method: "POST", headers: { "X-Flock-User": "maya" } });   // undo needs an identity

async function fixture() {
  const { hono, db } = await boot();
  await db.insert(customers).values([{ id: "c1", name: "Local Co", gstin: "29AABCT5521M1ZP" }, { id: "c2", name: "Chennai Co", gstin: "33AAACK2284F1ZD" }]);
  await db.insert(invoices).values([
    { id: "i1", number: "INV-2026-0001", customer_id: "c1", issue_date: "2026-09-01", due_date: "2026-09-30", status: "sent" },     // overdue, part paid
    { id: "i2", number: "INV-2026-0002", customer_id: "c2", issue_date: "2026-10-01", due_date: "2026-10-31", status: "sent" },     // open
    { id: "i3", number: "INV-2026-0003", customer_id: "c1", issue_date: "2026-09-02", due_date: "2026-09-20", status: "sent" },     // paid in full this month
    { id: "i4", number: "INV-2026-0004", customer_id: "c1", issue_date: "2026-10-05", due_date: "2026-11-05", status: "draft" },
    { id: "i5", number: "INV-2026-0005", customer_id: "c1", issue_date: "2026-08-05", due_date: "2026-08-20", status: "void" },
  ]);
  await db.insert(invoice_lines).values([
    { invoice_id: "i1", description: "Design", qty: 1, unit_price: 10000, gst_rate: 18 },          // 11,800
    { invoice_id: "i2", description: "Design", qty: 1, unit_price: 10000, gst_rate: 18 },          // 11,800 IGST
    { invoice_id: "i3", description: "Print", qty: 10, unit_price: 100, gst_rate: 12 },            // 1,120
    { invoice_id: "i4", description: "Draft work", qty: 1, unit_price: 500, gst_rate: 0 },
    { invoice_id: "i5", description: "Mistake", qty: 1, unit_price: 700, gst_rate: 0 },
  ]);
  await db.insert(payments).values([
    { invoice_id: "i1", date: "2026-10-02", amount: 4000, method: "upi" },
    { invoice_id: "i3", date: "2026-10-04", amount: 1120, method: "bank", ref: "NEFT1" },
    { invoice_id: "i3", date: "2026-09-25", amount: 0.01, method: "cash" },                      // last month: not "this month"
  ]);
  return { hono, db };
}

describe("overdue is derived", () => {
  it("is overdue when sent, unpaid and past due; paid when the payments cover the total", async () => {
    const { db } = await fixture();
    const by = Object.fromEntries(enrichInvoices(db, OWNER, TODAY).map((r) => [r.number, r]));
    expect(by["INV-2026-0001"]).toMatchObject({ status: "overdue", total: 11800, paid: 4000, balance: 7800, days_overdue: 9 });
    expect(by["INV-2026-0002"]).toMatchObject({ status: "sent", total: 11800, balance: 11800, days_overdue: 0 });
    expect(by["INV-2026-0003"]).toMatchObject({ status: "paid", balance: 0 });
    expect(by["INV-2026-0004"].status).toBe("draft");
    expect(by["INV-2026-0005"]).toMatchObject({ status: "void", balance: 0 });
  });
  it("moves with the date the viewer sends", async () => {
    const { db } = await fixture();
    expect(enrichInvoices(db, OWNER, "2026-09-29").find((r) => r.number === "INV-2026-0001")!.status).toBe("sent");
    expect(enrichInvoices(db, OWNER, "2026-09-30").find((r) => r.number === "INV-2026-0001")!.status).toBe("sent");     // due that day
    expect(enrichInvoices(db, OWNER, "2026-10-01").find((r) => r.number === "INV-2026-0001")!.status).toBe("overdue");
  });
});

describe("GET /api/invoice-summary", () => {
  it("adds up what is owed, what is late and what came in this month", async () => {
    const { hono } = await fixture();
    const r = await get(hono, `/api/invoice-summary?today=${TODAY}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ outstanding: 19600, overdue: 7800, overdue_count: 1, paid_this_month: 5120, drafts: 1 });
  });
  it("rejects a malformed date", async () => { expect((await get((await boot()).hono, "/api/invoice-summary?today=yesterday")).status).toBe(400); });
});

describe("GET /api/invoice-list", () => {
  it("filters by derived status, searches number and customer, and pages", async () => {
    const { hono } = await fixture();
    const overdue = await get(hono, `/api/invoice-list?today=${TODAY}&status=overdue`);
    expect(overdue.body.rows.map((r: any) => r.number)).toEqual(["INV-2026-0001"]);
    expect((await get(hono, `/api/invoice-list?today=${TODAY}&q=chennai`)).body.rows.map((r: any) => r.number)).toEqual(["INV-2026-0002"]);
    const p1 = await get(hono, `/api/invoice-list?today=${TODAY}&limit=2`);
    expect(p1.body.rows.map((r: any) => r.number)).toEqual(["INV-2026-0004", "INV-2026-0002"]);   // newest issue date first
    expect(p1.body.total).toBe(5);
    const p2 = await get(hono, `/api/invoice-list?today=${TODAY}&limit=2&cursor=${p1.body.nextCursor}`);
    expect(p2.body.rows).toHaveLength(2);
    const p3 = await get(hono, `/api/invoice-list?today=${TODAY}&limit=2&cursor=${p2.body.nextCursor}`);
    expect(p3.body.rows).toHaveLength(1);
    expect(p3.body.nextCursor).toBeNull();
  });
  it("answers sloppy parameters with a 400 that names the field", async () => {
    const { hono } = await fixture();
    expect((await get(hono, "/api/invoice-list?status=lost")).body.field).toBe("status");
    expect((await get(hono, "/api/invoice-list?limit=abc")).body.field).toBe("limit");
    expect((await get(hono, "/api/invoice-list?cursor=-4")).body.field).toBe("cursor");
  });
});

describe("GET /api/invoice/:id", () => {
  it("returns the invoice with its lines, payments and the shared totals (IGST between states)", async () => {
    const { hono } = await fixture();
    const r = await get(hono, `/api/invoice/i2?today=${TODAY}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "sent", inter_state: true, subtotal: 10000, tax: 1800, total: 11800, balance: 11800 });
    expect(r.body.totals.map((t: any) => t.label)).toEqual(["Subtotal", "IGST 18%", "Total"]);
    const local = await get(hono, `/api/invoice/i1?today=${TODAY}`);
    expect(local.body.totals.map((t: any) => t.label)).toEqual(["Subtotal", "CGST 9%", "SGST 9%", "Total"]);
    expect(local.body.payments).toHaveLength(1);
    expect(local.body.customer.name).toBe("Local Co");
  });
  it("is a 404 for an unknown invoice", async () => { expect((await get((await fixture()).hono, "/api/invoice/nope")).status).toBe(404); });
});

describe("GET /api/next-number", () => {
  it("continues the year", async () => {
    const { hono } = await fixture();
    expect((await get(hono, "/api/next-number?year=2026")).body.number).toBe("INV-2026-0006");
    expect((await get(hono, "/api/next-number?year=2027")).body.number).toBe("INV-2027-0001");
  });
});

describe("kit writes", () => {
  it("deletes only drafts: an issued invoice answers 409 and stays", async () => {
    const { hono, db } = await fixture();
    for (const id of ["i1", "i3", "i5"]) {   // sent, paid, void
      const r = await send(hono, "DELETE", `/api/_data/invoices/${id}`);
      expect(r.status).toBe(409);
      expect(r.body.error).toBe("issued");
    }
    expect((await send(hono, "DELETE", "/api/_data/invoices/i4")).status).toBe(200);   // the draft
    expect(db.select().from(invoices).all().map((i) => i.id).sort()).toEqual(["i1", "i2", "i3", "i5"]);
    expect((await send(hono, "DELETE", "/api/_data/invoices/nope")).status).toBe(404);
  });
  it("takes a custom rate with decimals on a line (0.25% on rough diamonds)", async () => {
    const { hono } = await fixture();
    const r = await send(hono, "POST", "/api/_data/invoice_lines", { invoice_id: "i4", description: "Rough diamonds", qty: 1, unit_price: 99999, gst_rate: 0.25 });
    expect(r.status).toBe(201);
    expect((await get(hono, `/api/invoice/i4?today=${TODAY}`)).body.totals.map((t: any) => t.label)).toContain("CGST 0.125%");
  });
  it("a line stored at 12% before the 2025 change still shows and totals at 12%", async () => {
    const { hono } = await fixture();
    const d = (await get(hono, `/api/invoice/i3?today=${TODAY}`)).body;
    expect(d.lines[0].gst_rate).toBe(12);
    expect(d.totals.map((t: any) => [t.label, t.value])).toEqual([["Subtotal", 1000], ["CGST 6%", 60], ["SGST 6%", 60], ["Total", 1120]]);
  });
  it("answers a duplicate invoice number with a 409 that names the field", async () => {
    const { hono } = await fixture();
    const r = await hono.request("/api/_data/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ number: "INV-2026-0001", customer_id: "c1", issue_date: "2026-10-09", due_date: "2026-11-09" }) });
    expect(r.status).toBe(409);
    expect(((await r.json()) as any).field).toBe("number");
  });
});


describe("an issued invoice keeps the customer as billed", () => {
  async function issued() {
    const { hono, db } = await boot();
    const k = (await send(hono, "POST", "/api/_data/customers", { name: "Kanchi Looms", gstin: "33AAACK2284F1ZD", address: "T. Nagar, Chennai", email: "a@k.example" })).body.row.id;
    const v = (await send(hono, "POST", "/api/_data/invoices", { number: "INV-2026-0100", customer_id: k, issue_date: "2026-10-01", due_date: "2026-10-31", status: "draft" })).body.row.id;
    await send(hono, "POST", "/api/_data/invoice_lines", { invoice_id: v, description: "Catalogue", qty: 1, unit_price: 1000, gst_rate: 18 });
    const issue = (await send(hono, "PATCH", `/api/_data/invoices/${v}`, { status: "sent" })).body.changeId as string;
    return { hono, db, k, v, issue };
  }
  it("deleting the customer leaves the billed name, address, GSTIN and IGST in place", async () => {
    const { hono, k, v } = await issued();
    expect((await send(hono, "DELETE", `/api/_data/customers/${k}`)).status).toBe(200);
    const d = (await get(hono, `/api/invoice/${v}?today=${TODAY}`)).body;
    expect(d.customer).toMatchObject({ name: "Kanchi Looms", address: "T. Nagar, Chennai", gstin: "33AAACK2284F1ZD" });
    expect(d.inter_state).toBe(true);
    expect(d.totals.map((t: any) => t.label)).toEqual(["Subtotal", "IGST 18%", "Total"]);
    expect((await get(hono, `/api/invoice-list?today=${TODAY}`)).body.rows[0].customer_name).toBe("Kanchi Looms");
  });
  it("editing the customer later does not rewrite it or flip IGST to CGST + SGST", async () => {
    const { hono, k, v } = await issued();
    await send(hono, "PATCH", `/api/_data/customers/${k}`, { name: "Kanchi Looms Bengaluru", gstin: "29AAACK2284F1ZD", address: "Jayanagar, Bengaluru", email: "new@k.example" });
    const d = (await get(hono, `/api/invoice/${v}?today=${TODAY}`)).body;
    expect(d.customer).toMatchObject({ name: "Kanchi Looms", gstin: "33AAACK2284F1ZD", address: "T. Nagar, Chennai", email: "new@k.example" });   // contact details stay live
    expect(d.totals.map((t: any) => t.label)).toEqual(["Subtotal", "IGST 18%", "Total"]);
    expect(d.place_of_supply).toBe("33");
  });
  it("a draft follows the live customer (back to draft through an Undo of the issue)", async () => {
    const { hono, k, v, issue } = await issued();
    expect((await undo(hono, issue)).status).toBe(200);
    await send(hono, "PATCH", `/api/_data/customers/${k}`, { name: "Kanchi Looms Bengaluru", gstin: "29AAACK2284F1ZD" });
    const d = (await get(hono, `/api/invoice/${v}?today=${TODAY}`)).body;
    expect(d.customer.name).toBe("Kanchi Looms Bengaluru");
    expect(d.totals.map((t: any) => t.label)).toEqual(["Subtotal", "CGST 9%", "SGST 9%", "Total"]);
    // issuing it again takes a fresh copy
    await send(hono, "PATCH", `/api/_data/invoices/${v}`, { status: "sent" });
    await send(hono, "PATCH", `/api/_data/customers/${k}`, { name: "Renamed again" });
    expect((await get(hono, `/api/invoice/${v}?today=${TODAY}`)).body.customer.name).toBe("Kanchi Looms Bengaluru");
  });
  it("an issued invoice cannot be moved to another customer", async () => {
    const { hono, v } = await issued();
    const m = (await send(hono, "POST", "/api/_data/customers", { name: "Mysuru Silks", gstin: "29AAACM1111A1ZA" })).body.row.id;
    const r = await send(hono, "PATCH", `/api/_data/invoices/${v}`, { customer_id: m });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: "issued", field: "customer_id" });
    expect((await get(hono, `/api/invoice/${v}?today=${TODAY}`)).body.customer.name).toBe("Kanchi Looms");
  });
  it("an invoice created already issued is copied at once", async () => {
    const { hono } = await boot();
    const k = (await send(hono, "POST", "/api/_data/customers", { name: "Kanchi Looms", gstin: "33AAACK2284F1ZD" })).body.row.id;
    const w = (await send(hono, "POST", "/api/_data/invoices", { number: "INV-2026-0101", customer_id: k, issue_date: "2026-10-01", due_date: "2026-10-31", status: "sent" })).body.row.id;
    await send(hono, "DELETE", `/api/_data/customers/${k}`);
    expect((await get(hono, `/api/invoice/${w}?today=${TODAY}`)).body.customer.name).toBe("Kanchi Looms");
  });
  it("ignores a bill_to sent by a client: the server always takes its own copy", async () => {
    const { hono, k, v } = await issued();
    const forged = JSON.stringify({ customer_id: k, name: "Forged Pvt Ltd", address: null, gstin: "29AAAAA0000A1Z5", place_of_supply: "29", inter_state: false });
    await send(hono, "PATCH", `/api/_data/invoices/${v}`, { bill_to: forged, notes: "edited" });
    let d = (await get(hono, `/api/invoice/${v}?today=${TODAY}`)).body;
    expect(d.customer.name).toBe("Kanchi Looms");
    expect(d.inter_state).toBe(true);
    expect(d.invoice.notes).toBe("edited");
    const w = (await send(hono, "POST", "/api/_data/invoices", { number: "INV-2026-0102", customer_id: k, issue_date: "2026-10-01", due_date: "2026-10-31", status: "sent", bill_to: forged })).body.row.id;
    d = (await get(hono, `/api/invoice/${w}?today=${TODAY}`)).body;
    expect(d.customer.name).toBe("Kanchi Looms");
  });
  it("an Undo of a move made while it was a draft re-takes the copy from the first customer as they are now (it does not restore the old copy)", async () => {
    const { hono, k } = await issued();
    const m = (await send(hono, "POST", "/api/_data/customers", { name: "Mysuru Silks", gstin: "29AAACM1111A1ZA" })).body.row.id;
    const v = (await send(hono, "POST", "/api/_data/invoices", { number: "INV-2026-0103", customer_id: k, issue_date: "2026-10-01", due_date: "2026-10-31", status: "draft" })).body.row.id;
    const moved = await send(hono, "PATCH", `/api/_data/invoices/${v}`, { customer_id: m });
    await send(hono, "PATCH", `/api/_data/invoices/${v}`, { status: "sent" });
    expect((await get(hono, `/api/invoice/${v}?today=${TODAY}`)).body.customer.name).toBe("Mysuru Silks");
    await send(hono, "PATCH", `/api/_data/customers/${k}`, { name: "Kanchi Looms (renamed)" });
    expect((await undo(hono, moved.body.changeId)).status).toBe(200);
    const d = (await get(hono, `/api/invoice/${v}?today=${TODAY}`)).body;
    expect(d.customer.name).toBe("Kanchi Looms (renamed)");
    expect(d.inter_state).toBe(true);
  });
  it("the sample's issued invoices carry their copy from the first boot", async () => {
    const { db } = await boot(new Date(2026, 9, 9));
    const all = db.select().from(invoices).all();
    expect(all.filter((i) => i.status !== "draft").every((i) => i.bill_to !== null)).toBe(true);
    expect(all.filter((i) => i.status === "draft").every((i) => i.bill_to === null)).toBe(true);
  });
});

const setSettings = (hono: Hono, patch: Record<string, unknown>) =>
  hono.request("/api/_app/settings", { method: "PATCH", headers: { "Content-Type": "application/json", "X-Flock-User": "maya" }, body: JSON.stringify(patch) });

describe("an issued invoice keeps the seller as it was when issued", () => {
  async function two() {
    const { hono, db } = await boot();
    const k = (await send(hono, "POST", "/api/_data/customers", { name: "Kanchi Looms", gstin: "33AAACK2284F1ZD" })).body.row.id;
    const make = async (number: string) => (await send(hono, "POST", "/api/_data/invoices", { number, customer_id: k, issue_date: "2026-10-01", due_date: "2026-10-31", status: "draft" })).body.row.id;
    const issued = await make("INV-2026-0001"), draft = await make("INV-2026-0002");
    for (const v of [issued, draft]) await send(hono, "POST", "/api/_data/invoice_lines", { invoice_id: v, description: "Catalogue", qty: 1, unit_price: 1000, gst_rate: 18 });
    const issue = (await send(hono, "PATCH", `/api/_data/invoices/${issued}`, { status: "sent" })).body.changeId as string;
    return { hono, db, k, issued, draft, issue };
  }
  it("issuing copies the seller; renaming the business afterwards leaves the issued invoice and moves the draft", async () => {
    const { hono, db, issued, draft } = await two();
    const copy = JSON.parse(db.select().from(invoices).all().find((i) => i.id === issued)!.seller!);
    expect(copy).toEqual({ name: SAMPLE_BUSINESS.name, gstin: SAMPLE_BUSINESS.gstin, address: SAMPLE_BUSINESS.address, email: SAMPLE_BUSINESS.email, pay: SAMPLE_BUSINESS.pay, state: "29" });
    expect(db.select().from(invoices).all().find((i) => i.id === draft)!.seller).toBeNull();
    // The owner moves the business to Chennai under a new name.
    expect((await setSettings(hono, { "business.name": "Kanchi Studio", "business.gstin": "33AAEPB4172K1ZB", "business.pay": "UPI kanchi@okicici", seller_state: "33" })).status).toBe(200);
    const i = (await get(hono, `/api/invoice/${issued}?today=${TODAY}`)).body;
    expect(i.seller).toMatchObject({ name: SAMPLE_BUSINESS.name, gstin: SAMPLE_BUSINESS.gstin, pay: SAMPLE_BUSINESS.pay, state: "29" });
    expect(i.inter_state).toBe(true);                                   // still IGST: Karnataka to Tamil Nadu, as issued
    expect(i.totals.map((t: any) => t.label)).toEqual(["Subtotal", "IGST 18%", "Total"]);
    const d = (await get(hono, `/api/invoice/${draft}?today=${TODAY}`)).body;
    expect(d.seller).toMatchObject({ name: "Kanchi Studio", gstin: "33AAEPB4172K1ZB", pay: "UPI kanchi@okicici", state: "33" });
    expect(d.inter_state).toBe(false);                                  // the draft follows: now Tamil Nadu to Tamil Nadu
    expect(d.totals.map((t: any) => t.label)).toEqual(["Subtotal", "CGST 9%", "SGST 9%", "Total"]);
    // Issuing the draft now copies the new seller.
    await send(hono, "PATCH", `/api/_data/invoices/${draft}`, { status: "sent" });
    await setSettings(hono, { "business.name": "Renamed again" });
    expect((await get(hono, `/api/invoice/${draft}?today=${TODAY}`)).body.seller.name).toBe("Kanchi Studio");
  });
  it("back to draft (an Undo of the issue) drops the copy, and issuing again takes the seller as it is then", async () => {
    const { hono, issued, issue } = await two();
    expect((await undo(hono, issue)).status).toBe(200);
    await setSettings(hono, { "business.name": "Kanchi Studio" });
    expect((await get(hono, `/api/invoice/${issued}?today=${TODAY}`)).body.seller.name).toBe("Kanchi Studio");
    await send(hono, "PATCH", `/api/_data/invoices/${issued}`, { status: "sent" });
    await setSettings(hono, { "business.name": "Renamed again" });
    expect((await get(hono, `/api/invoice/${issued}?today=${TODAY}`)).body.seller.name).toBe("Kanchi Studio");
  });
  it("an Undo that moves an issued invoice back to its first customer judges the supply from the seller as issued, not the state code now", async () => {
    const { hono } = await two();
    const tn = (await send(hono, "POST", "/api/_data/customers", { name: "Chennai Silks", gstin: "33AAACM1111A1ZA" })).body.row.id;
    const ka = (await send(hono, "POST", "/api/_data/customers", { name: "Mysuru Silks", gstin: "29AAACM1111A1ZA" })).body.row.id;
    const x = (await send(hono, "POST", "/api/_data/invoices", { number: "INV-2026-0007", customer_id: ka, issue_date: "2026-10-01", due_date: "2026-10-31", status: "draft" })).body.row.id;
    await send(hono, "POST", "/api/_data/invoice_lines", { invoice_id: x, description: "Catalogue", qty: 1, unit_price: 1000, gst_rate: 18 });
    const moved = (await send(hono, "PATCH", `/api/_data/invoices/${x}`, { customer_id: tn })).body.changeId;
    await send(hono, "PATCH", `/api/_data/invoices/${x}`, { status: "sent" });   // issued from Karnataka (29) to Tamil Nadu: IGST
    let d = (await get(hono, `/api/invoice/${x}?today=${TODAY}`)).body;
    expect([d.customer.name, d.inter_state, d.place_of_supply]).toEqual(["Chennai Silks", true, "33"]);
    await setSettings(hono, { seller_state: "33", "business.gstin": "33AAEPB4172K1ZB" });   // the business moves to Tamil Nadu
    expect((await undo(hono, moved)).status).toBe(200);
    d = (await get(hono, `/api/invoice/${x}?today=${TODAY}`)).body;
    expect(d.seller.state).toBe("29");
    expect([d.customer.name, d.inter_state, d.place_of_supply]).toEqual(["Mysuru Silks", false, "29"]);   // 29 → 29, as issued
    expect(d.totals.map((t: any) => t.label)).toEqual(["Subtotal", "CGST 9%", "SGST 9%", "Total"]);
  });
  it("an unregistered seller charges no tax: a draft follows the setting, an issued invoice its copy", async () => {
    const { hono, issued, draft } = await two();
    await setSettings(hono, { "business.gstin": "" });   // the owner says the business is not registered
    const d = (await get(hono, `/api/invoice/${draft}?today=${TODAY}`)).body;
    expect(d).toMatchObject({ gst_registered: false, subtotal: 1000, tax: 0, total: 1000, balance: 1000 });
    expect(d.totals.map((t: any) => t.label)).toEqual(["Subtotal", "Total"]);
    const i = (await get(hono, `/api/invoice/${issued}?today=${TODAY}`)).body;   // issued while registered: its tax stays
    expect(i).toMatchObject({ gst_registered: true, tax: 180, total: 1180 });
    expect((await get(hono, `/api/invoice-summary?today=${TODAY}`)).body.outstanding).toBe(1180);   // only sent invoices count; the draft is not owed
    await send(hono, "PATCH", `/api/_data/invoices/${draft}`, { status: "sent" });
    await setSettings(hono, { "business.gstin": "33AAEPB4172K1ZB" });   // registering later does not add tax to what was issued without it
    expect((await get(hono, `/api/invoice/${draft}?today=${TODAY}`)).body).toMatchObject({ gst_registered: false, tax: 0, total: 1000 });
  });
  it("ignores a seller sent by a client: the server always takes its own copy", async () => {
    const { hono, k, issued } = await two();
    const forged = JSON.stringify({ name: "Forged Pvt Ltd", gstin: "29AAAAA0000A1Z5", address: null, email: null, pay: "UPI thief@okaxis", state: "29" });
    await send(hono, "PATCH", `/api/_data/invoices/${issued}`, { seller: forged, notes: "edited" });
    let d = (await get(hono, `/api/invoice/${issued}?today=${TODAY}`)).body;
    expect(d.seller.name).toBe(SAMPLE_BUSINESS.name);
    expect(d.invoice.notes).toBe("edited");
    const w = (await send(hono, "POST", "/api/_data/invoices", { number: "INV-2026-0009", customer_id: k, issue_date: "2026-10-01", due_date: "2026-10-31", status: "sent", seller: forged })).body.row.id;
    d = (await get(hono, `/api/invoice/${w}?today=${TODAY}`)).body;
    expect(d.seller.pay).toBe(SAMPLE_BUSINESS.pay);
    expect(SERVER_COLUMNS.invoices).toEqual(expect.arrayContaining(["bill_to", "seller"]));
  });
  it("a new prefix numbers new invoices only: issued numbers keep theirs", async () => {
    const { hono, issued, draft } = await two();
    expect((await get(hono, "/api/next-number?year=2026")).body.number).toBe("INV-2026-0003");
    await setSettings(hono, { number_prefix: "KS" });
    expect((await get(hono, "/api/next-number?year=2026")).body.number).toBe("KS-2026-0001");
    expect((await get(hono, `/api/invoice/${issued}?today=${TODAY}`)).body.invoice.number).toBe("INV-2026-0001");
    expect((await get(hono, `/api/invoice/${draft}?today=${TODAY}`)).body.invoice.number).toBe("INV-2026-0002");
  });
  it("the sample's issued invoices carry the seller from the first boot, drafts none", async () => {
    const { db } = await boot(new Date(2026, 9, 9));
    const all = db.select().from(invoices).all();
    expect(all.filter((i) => i.status !== "draft").every((i) => JSON.parse(i.seller!).name === SAMPLE_BUSINESS.name)).toBe(true);
    expect(all.filter((i) => i.status === "draft").every((i) => i.seller === null)).toBe(true);
  });
  it("an import with an issued invoice but not every business setting is refused: the sample seller is never frozen onto it", async () => {
    const { kit, db } = await boot(false, {
      importId: "imp-2", by: "flock-helper", settings: { "business.name": "Asha Tuition Centre" },
      rows: {
        customers: [{ $key: "ravi", name: "Ravi Menon" }],
        invoices: [{ $key: "sept", number: "ATC-2026-0001", customer_id: { $ref: "customers/ravi" }, issue_date: "2026-09-01", due_date: "2026-09-15", status: "paid" }],
      },
    });
    expect(kit.importState).toMatchObject({ state: "failed" });
    expect(String((kit.importState as any).error)).toMatch(/settings\.business\.gstin: required when the rows include an issued invoice/);
    expect(db.select().from(invoices).all()).toEqual([]);
  });
  it("an imported issued invoice has its seller (the imported settings) and its bill_to after boot", async () => {
    const { hono, db, kit } = await boot(false, {
      importId: "imp-1", by: "flock-helper",
      settings: { "business.name": "Asha Tuition Centre", "business.gstin": "", "business.address": "Kochi", "business.email": "", "business.pay": "UPI asha@oksbi", seller_state: "32", number_prefix: "ATC" },
      rows: {
        customers: [{ $key: "ravi", name: "Ravi Menon", gstin: "29AABCT5521M1ZP", address: "Kochi" }],
        invoices: [
          { $key: "sept", number: "ATC-2026-0001", customer_id: { $ref: "customers/ravi" }, issue_date: "2026-09-01", due_date: "2026-09-15", status: "sent" },
          { $key: "oct", number: "ATC-2026-0002", customer_id: { $ref: "customers/ravi" }, issue_date: "2026-10-01", due_date: "2026-10-15", status: "draft" },
        ],
        invoice_lines: [{ $key: "l1", invoice_id: { $ref: "invoices/sept" }, description: "September fees", qty: 1, unit_price: 4000, gst_rate: 18 }],
        payments: [{ $key: "p1", invoice_id: { $ref: "invoices/sept" }, date: "2026-09-10", amount: 2000, method: "upi" }],
      },
    });
    expect(kit.importState.state).toBe("done");
    const sept = db.select().from(invoices).all().find((i) => i.number === "ATC-2026-0001")!;
    expect(JSON.parse(sept.seller!)).toEqual({ name: "Asha Tuition Centre", gstin: "", address: "Kochi", email: "", pay: "UPI asha@oksbi", state: "32" });
    expect(JSON.parse(sept.bill_to!)).toMatchObject({ name: "Ravi Menon", inter_state: true, place_of_supply: "29" });
    expect(db.select().from(invoices).all().find((i) => i.number === "ATC-2026-0002")!.seller).toBeNull();
    // Asha is not registered for GST (empty GSTIN), so the invoice carries no tax: an unregistered supplier cannot collect GST.
    const d = (await get(hono, `/api/invoice/${sept.id}?today=${TODAY}`)).body;
    expect(d).toMatchObject({ gst_registered: false, subtotal: 4000, tax: 0, total: 4000, paid: 2000, balance: 2000, inter_state: true });
    expect(d.totals.map((t: any) => t.label)).toEqual(["Subtotal", "Total"]);
    expect(d.lines[0].gst_rate).toBe(18);   // the stored rate is kept; it is just not charged
    expect((await get(hono, `/api/invoice-list?today=${TODAY}`)).body.rows.find((r: any) => r.id === sept.id)).toMatchObject({ total: 4000, balance: 2000 });
    expect((await get(hono, "/api/next-number?year=2026")).body.number).toBe("ATC-2026-0003");
  });
});

describe("the settings' own checks", () => {
  it("refuses a bad state code, GSTIN or prefix with a 400 naming the field, and changes nothing", async () => {
    const { hono } = await boot();
    for (const [field, value] of [["seller_state", "KA"], ["business.gstin", "29aaepb4172k1zb"], ["number_prefix", "INV 2026"]] as const) {
      const r = await setSettings(hono, { [field]: value });
      expect(r.status).toBe(400);
      expect(((await r.json()) as any).field).toBe(field);
    }
    const app = (await get(hono, "/api/_app")).body;
    expect(app.settings).toMatchObject({ seller_state: "29", "business.gstin": SAMPLE_BUSINESS.gstin, number_prefix: "INV", "business.name": SAMPLE_BUSINESS.name });
  });
  it("fails a boot import whose settings break a check, and imports nothing", async () => {
    const { kit, db } = await boot(false, { importId: "imp-bad", by: "flock-helper", settings: { seller_state: "99" }, rows: { customers: [{ $key: "a", name: "A" }] } });
    expect(kit.importState.state).toBe("failed");
    expect(db.select().from(customers).all()).toHaveLength(0);
  });
});

describe("an app made before the settings", () => {
  it("upgrades to the links and the seller field without asking the owner, keeps its rows, and backfills the seller", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "invoice-upgrade-"));
    const env = { appId: "t", dataDir, apiUrl: null, token: null, agent: null };
    const pending = { isApproved: async () => false, request: async () => ({ status: "pending" }) };
    // The schema as it was: no seller field and no declared links (invoices.number is unique, so the rebuild must make its index once).
    const old = {
      customers: sqliteTable("customers", { ...kitColumns(), name: text("name").notNull(), gstin: text("gstin"), email: text("email"), phone: text("phone"), address: text("address") }),
      invoices: sqliteTable("invoices", { ...kitColumns(), number: text("number").notNull().unique(), customer_id: text("customer_id").notNull(), issue_date: text("issue_date").notNull(), due_date: text("due_date").notNull(), status: text("status").notNull().default("draft"), notes: text("notes"), bill_to: text("bill_to") }),
      invoice_lines: sqliteTable("invoice_lines", { ...kitColumns(), invoice_id: text("invoice_id").notNull(), description: text("description").notNull(), qty: real("qty").notNull().default(1), unit_price: real("unit_price").notNull().default(0), gst_rate: real("gst_rate").notNull().default(18) }),
      payments: sqliteTable("payments", { ...kitColumns(), invoice_id: text("invoice_id").notNull(), date: text("date").notNull(), amount: real("amount").notNull(), method: text("method").notNull().default("upi"), ref: text("ref") }),
    };
    const first = await mountKit({ hono: new Hono(), env }, { schema: old, appName: "T", approvals: pending });
    expect(first.status.state).toBe("ok");
    first.sqlite.run(`INSERT INTO customers (id, created_at, updated_at, name, gstin) VALUES ('c','t','t','Kanchi Looms','33AAACK2284F1ZD')`);
    first.sqlite.run(`INSERT INTO invoices (id, created_at, updated_at, number, customer_id, issue_date, due_date, status) VALUES ('x','t','t','INV-1','c','2026-10-01','2026-10-31','sent')`);
    first.sqlite.run(`INSERT INTO invoice_lines (id, created_at, updated_at, invoice_id, description, qty, unit_price, gst_rate) VALUES ('l','t','t','x','Catalogue',1,1000,18)`);
    first.sqlite.close();
    const hono = new Hono();
    const kit = await mountKit({ hono, env }, { schema, appName: "T", approvals: pending, serverColumns: SERVER_COLUMNS, settings: SETTINGS });
    expect(kit.status.state).toBe("ok");
    mountInvoiceRoutes(hono, kit.db, kit.settings, kit.ctx.events, kit.status);
    expect((await get(hono, `/api/invoice/x?today=${TODAY}`)).body).toMatchObject({ seller: { name: "" }, customer: { name: "Kanchi Looms" }, inter_state: true, gst_registered: false, total: 1000 });
  });
});

describe("a boot whose schema change waits for the owner", () => {
  it("still starts and serves the waiting state, without the bill_to copy", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "invoice-blocked-"));
    const env = { appId: "t", dataDir, apiUrl: null, token: null, agent: null };
    const pending = { isApproved: async () => false, request: async () => ({ status: "pending" }) };
    // An older app: invoices has a field the new schema drops, and no bill_to yet.
    const old = { ...schema, invoices: sqliteTable("invoices", { ...kitColumns(), number: text("number").notNull(), customer_id: text("customer_id").notNull(), issue_date: text("issue_date").notNull(), due_date: text("due_date").notNull(), status: text("status").notNull(), notes: text("notes"), legacy: text("legacy") }) };
    const first = await mountKit({ hono: new Hono(), env }, { schema: old, appName: "T", approvals: pending });
    first.sqlite.run(`INSERT INTO customers (id, created_at, updated_at, name, gstin) VALUES ('c','t','t','Kanchi Looms','33AAACK2284F1ZD')`);
    first.sqlite.run(`INSERT INTO invoices (id, created_at, updated_at, number, customer_id, issue_date, due_date, status, legacy) VALUES ('x','t','t','INV-1','c','2026-10-01','2026-10-31','sent','y')`);
    first.sqlite.close();
    const hono = new Hono();
    const kit = await mountKit({ hono, env }, { schema, appName: "T", approvals: pending, serverColumns: SERVER_COLUMNS, settings: SETTINGS });
    expect(kit.status.state).toBe("blocked");
    mountInvoiceRoutes(hono, kit.db, kit.settings, kit.ctx.events, kit.status);
    expect((await get(hono, "/api/health")).body).toMatchObject({ schema: "blocked" });
  });
});

describe("the sample data", () => {
  afterEach(() => setSystemTime());
  // The seed and the judgement use one clock: the sample is told from `from`, and "today" is `from` too.
  const story = async (from?: Date) => {
    const s = sampleData(from);
    const { db } = await boot(from ?? true);
    const rows = enrichInvoices(db, OWNER, inDays(0, from));
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(["draft", "sent", "paid", "overdue", "void"]));
    expect(rows.length).toBe(s.invoices.length);
    expect(rows.some((r) => r.status === "overdue" && r.paid > 0)).toBe(true);
    expect(new Set(s.invoices.map((i) => i.number)).size).toBe(s.invoices.length);
    expect(rows.every((r) => r.total > 0)).toBe(true);
  };
  it("tells a believable story: every state of an invoice, a part payment and both tax splits", async () => {
    await story(new Date(2026, 9, 9));
  });
  it("tells the same story whatever the real date is (a relative seed never meets an absolute today)", async () => {
    for (const day of ["2026-10-08T10:00:00", "2026-10-20T10:00:00", "2026-12-01T10:00:00", "2027-01-01T10:00:00", "2027-03-31T23:30:00"]) {
      setSystemTime(new Date(day));
      await story();
      await story(new Date(2026, 9, 9));
    }
  });
});

describe("an issued invoice is locked: only its status moves on and its notes change", () => {
  async function issued() {
    const { hono, db } = await boot();
    const k = (await send(hono, "POST", "/api/_data/customers", { name: "Kanchi Looms", gstin: "33AAACK2284F1ZD" })).body.row.id;
    const make = async (number: string) => (await send(hono, "POST", "/api/_data/invoices", { number, customer_id: k, issue_date: "2026-10-01", due_date: "2026-10-31", status: "draft" })).body.row.id as string;
    const v = await make("INV-2026-0001"), draft = await make("INV-2026-0002");
    const line = (await send(hono, "POST", "/api/_data/invoice_lines", { invoice_id: v, description: "Catalogue", qty: 1, unit_price: 1000, gst_rate: 18 })).body.row.id as string;
    const draftLine = (await send(hono, "POST", "/api/_data/invoice_lines", { invoice_id: draft, description: "Draft work", qty: 1, unit_price: 500, gst_rate: 18 })).body.row.id as string;
    expect((await send(hono, "PATCH", `/api/_data/invoices/${v}`, { status: "sent" })).status).toBe(200);
    return { hono, db, k, v, draft, line, draftLine };
  }
  const row = (db: any, id: string) => db.select().from(invoices).all().find((i: any) => i.id === id);
  const lines = (db: any, id: string) => db.select().from(invoice_lines).all().filter((l: any) => l.invoice_id === id).map((l: any) => [l.description, l.qty, l.unit_price]);

  it("refuses a new number, date or customer, and leaves the invoice as it was", async () => {
    const { hono, db, v } = await issued();
    for (const patch of [{ number: "INV-2026-0099" }, { issue_date: "2026-10-05" }, { due_date: "2026-12-31", notes: "x" }]) {
      const r = await send(hono, "PATCH", `/api/_data/invoices/${v}`, patch);
      expect(r.status, JSON.stringify(patch)).toBe(409);
      expect(r.body.error).toBe("issued");
    }
    expect(row(db, v)).toMatchObject({ number: "INV-2026-0001", issue_date: "2026-10-01", due_date: "2026-10-31", notes: null, status: "sent" });
  });
  it("never goes back to draft through PATCH", async () => {
    const { hono, db, v } = await issued();
    const r = await send(hono, "PATCH", `/api/_data/invoices/${v}`, { status: "draft" });
    expect([r.status, r.body.field]).toEqual([409, "status"]);
    expect(row(db, v).status).toBe("sent");
    expect(row(db, v).seller).not.toBeNull();
    expect((await send(hono, "DELETE", `/api/_data/invoices/${v}`)).status).toBe(409);
  });
  it("moves on to paid, back to sent, then void, with notes; a void invoice stays void", async () => {
    const { hono, db, v } = await issued();
    expect((await send(hono, "PATCH", `/api/_data/invoices/${v}`, { status: "paid", notes: "Paid by UPI" })).status).toBe(200);
    expect((await send(hono, "PATCH", `/api/_data/invoices/${v}`, { status: "sent" })).status).toBe(200);   // a payment was removed
    expect((await send(hono, "PATCH", `/api/_data/invoices/${v}`, { status: "void", number: "INV-2026-0001" })).status).toBe(200);   // an unchanged value is fine
    expect(row(db, v)).toMatchObject({ status: "void", notes: "Paid by UPI" });
    expect((await send(hono, "PATCH", `/api/_data/invoices/${v}`, { status: "sent" })).status).toBe(409);
    expect((await send(hono, "PATCH", `/api/_data/invoices/${v}`, { notes: "Voided: wrong rate" })).status).toBe(200);
  });
  it("refuses adding, changing, moving or removing its lines", async () => {
    const { hono, db, v, line, draftLine } = await issued();
    expect((await send(hono, "POST", "/api/_data/invoice_lines", { invoice_id: v, description: "Extra", qty: 1, unit_price: 1, gst_rate: 18 })).status).toBe(409);
    expect((await send(hono, "PATCH", `/api/_data/invoice_lines/${line}`, { unit_price: 1 })).status).toBe(409);
    expect((await send(hono, "PATCH", `/api/_data/invoice_lines/${draftLine}`, { invoice_id: v })).status).toBe(409);   // onto an issued invoice
    const del = await send(hono, "DELETE", `/api/_data/invoice_lines/${line}`);
    expect([del.status, del.body.error]).toEqual([409, "issued"]);
    expect(lines(db, v)).toEqual([["Catalogue", 1, 1000]]);
  });
  it("a draft and its lines stay freely editable", async () => {
    const { hono, db, draft, draftLine } = await issued();
    expect((await send(hono, "PATCH", `/api/_data/invoices/${draft}`, { number: "INV-2026-0005", due_date: "2026-11-30" })).status).toBe(200);
    expect((await send(hono, "PATCH", `/api/_data/invoice_lines/${draftLine}`, { unit_price: 600 })).status).toBe(200);
    expect((await send(hono, "POST", "/api/_data/invoice_lines", { invoice_id: draft, description: "More", qty: 2, unit_price: 50, gst_rate: 18 })).status).toBe(201);
    expect((await send(hono, "DELETE", `/api/_data/invoice_lines/${draftLine}`)).status).toBe(200);
    expect(lines(db, draft)).toEqual([["More", 2, 50]]);
    expect(row(db, draft).number).toBe("INV-2026-0005");
  });
});

describe("Clear samples after a sample invoice was issued (L10)", () => {
  it("keeps the issued invoice whole: its lines and payments are the owner's with it, not left as a Paid 0.00", async () => {
    const { hono } = await boot(true);
    const list = await get(hono, "/api/_data/invoices?limit=100");
    const draft = list.body.rows.find((r: any) => r.status === "draft");
    expect(draft._sample).toBe(true);
    expect((await send(hono, "PATCH", `/api/_data/invoices/${draft.id}`, { status: "sent" })).status).toBe(200);
    expect((await hono.request("/api/_data/_samples/clear", { method: "POST", headers: { "X-Flock-User": "maya" } })).status).toBe(200);
    const after = await get(hono, "/api/_data/invoices?limit=100");
    expect(after.body.rows.map((r: any) => r.id)).toEqual([draft.id]);
    const lines = await get(hono, "/api/_data/invoice_lines?limit=100");
    expect(lines.body.rows.filter((l: any) => l.invoice_id === draft.id)).toHaveLength(1);
    const one = await get(hono, `/api/invoice/${draft.id}`);
    expect(JSON.stringify(one.body)).toContain("Wayfinding signage");
  });
});

describe("boot repairs an already-issued sample invoice whose lines are still marked (L10 review)", () => {
  it("unmarks the lines and payments of an unmarked invoice, and leaves a still-sample invoice's alone", async () => {
    const { hono, db, kit } = await boot(true);
    const list = await get(hono, "/api/_data/invoices?limit=100");
    const draft = list.body.rows.find((r: any) => r.status === "draft");
    // Undo the adoption the way an older build left things: invoice no longer a sample, its lines still marked.
    await send(hono, "PATCH", `/api/_data/invoices/${draft.id}`, { status: "sent" });
    db.run(sql`INSERT INTO _samples (id, table_name, row_id, updated_by, created_at, updated_at) SELECT lower(hex(randomblob(8))), 'invoice_lines', id, 'app', '2026-10-10T00:00:00Z', '2026-10-10T00:00:00Z' FROM invoice_lines WHERE invoice_id = ${draft.id}`);
    const marked = () => (db.all(sql`SELECT 1 FROM _samples WHERE table_name = 'invoice_lines' AND row_id IN (SELECT id FROM invoice_lines WHERE invoice_id = ${draft.id})`) as unknown[]).length;
    expect(marked()).toBeGreaterThan(0);
    watchIssued(db, () => invoiceSettings(kit.settings.all()), kit.ctx.events);
    expect(marked()).toBe(0);
    watchIssued(db, () => invoiceSettings(kit.settings.all()), kit.ctx.events);   // idempotent
    const other = list.body.rows.find((r: any) => r.id !== draft.id && r._sample);
    const otherMarked = (db.all(sql`SELECT 1 FROM _samples WHERE table_name = 'invoice_lines' AND row_id IN (SELECT id FROM invoice_lines WHERE invoice_id = ${other.id})`) as unknown[]).length;
    expect(otherMarked).toBeGreaterThan(0);
  });
});

describe("a new app has no business identity of its own (the sample company is never the owner's)", () => {
  const KEYS = ["business.name", "business.gstin", "business.address", "business.email", "business.pay"];
  const draftIn = async (hono: Hono) => {
    const c = (await send(hono, "POST", "/api/_data/customers", { name: "Kanchi Looms" })).body.row.id;
    const make = (number: string, status = "draft") => send(hono, "POST", "/api/_data/invoices", { number, customer_id: c, issue_date: "2026-10-01", due_date: "2026-10-31", status });
    return { c, make };
  };
  it("every business setting defaults to empty, and an empty value is valid", async () => {
    const { hono } = await boot(false, undefined, true);
    const app = (await get(hono, "/api/_app")).body;
    for (const k of KEYS) expect(app.settings[k]).toBe("");
    expect(BUSINESS).toEqual({ name: "", gstin: "", address: "", email: "", pay: "" });
    for (const k of KEYS) expect((await setSettings(hono, { [k]: "" })).status).toBe(200);
    expect((await setSettings(hono, { "business.name": "   " })).status).toBe(200);
  });
  it("refuses to issue a real invoice while the company name is empty, and says what to do; drafts are fine", async () => {
    const { hono } = await boot(false, undefined, true);
    const { make } = await draftIn(hono);
    const id = (await make("INV-2026-0001")).body.row.id;
    await send(hono, "POST", "/api/_data/invoice_lines", { invoice_id: id, description: "Work", qty: 1, unit_price: 100, gst_rate: 0 });
    expect((await send(hono, "PATCH", `/api/_data/invoices/${id}`, { notes: "still editable" })).status).toBe(200);
    const r = await send(hono, "PATCH", `/api/_data/invoices/${id}`, { status: "sent" });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: "business_name_missing", field: "business.name" });
    expect(r.body.message).toContain("Add your company name in Settings before issuing");
    expect((await send(hono, "PATCH", `/api/_data/invoices/${id}`, { status: "paid" })).status).toBe(409);
    expect((await make("INV-2026-0002", "sent")).status).toBe(409);               // created already issued
    expect((await get(hono, `/api/invoice/${id}?today=${TODAY}`)).body.invoice.status).toBe("draft");
    expect((await setSettings(hono, { "business.name": "Kanchi Studio" })).status).toBe(200);
    expect((await send(hono, "PATCH", `/api/_data/invoices/${id}`, { status: "sent" })).status).toBe(200);
    expect((await get(hono, `/api/invoice/${id}?today=${TODAY}`)).body.seller.name).toBe("Kanchi Studio");
  });
  it("sample invoices still show the sample seller (as issued), the app's own settings stay empty", async () => {
    const { hono, db } = await boot(true, undefined, true);
    const rows = db.select().from(invoices).all();
    const issuedRows = rows.filter((i) => i.status !== "draft");
    expect(issuedRows.length).toBeGreaterThan(0);
    for (const i of issuedRows) expect(JSON.parse(i.seller!)).toMatchObject({ name: SAMPLE_BUSINESS.name, gstin: SAMPLE_BUSINESS.gstin });
    const one = (await get(hono, `/api/invoice/${issuedRows[0].id}?today=${TODAY}`)).body;
    expect(one.seller.name).toBe(SAMPLE_BUSINESS.name);
    expect(one.gst_registered).toBe(true);
    const app = (await get(hono, "/api/_app")).body;
    expect(app.settings["business.name"]).toBe("");
    // a sample draft may be issued (it is sample, not the owner's real invoice) and keeps the sample seller
    const draft = rows.find((i) => i.status === "draft")!;
    const r = await send(hono, "PATCH", `/api/_data/invoices/${draft.id}`, { status: "sent" });
    expect(r.status).toBe(200);
    expect((await get(hono, `/api/invoice/${draft.id}?today=${TODAY}`)).body.seller.name).toBe(SAMPLE_BUSINESS.name);
  });
});
