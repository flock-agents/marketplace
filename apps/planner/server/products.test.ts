// Products: the pack arithmetic, remember_product and import_order_history.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { addDays } from "./dates";
import { normItem, packsFor, parsePack, productFor, rememberProduct, toBase } from "./products";

describe("packs", () => {
  it("normItem lowercases, trims and keeps single spaces", () => {
    expect(normItem("  Amul   Taaza\tMilk ")).toBe("amul taaza milk");
  });

  it("toBase reads weights, volumes and pieces, and nothing else", () => {
    expect(toBase(1.2, "kg")).toEqual({ amount: 1200, unit: "g" });
    expect(toBase(1.1, "KG")).toEqual({ amount: 1100, unit: "g" });
    expect(toBase(250, " g ")).toEqual({ amount: 250, unit: "g" });
    expect(toBase(2, "l")).toEqual({ amount: 2000, unit: "ml" });
    expect(toBase(500, "ml")).toEqual({ amount: 500, unit: "ml" });
    for (const u of ["pc", "pcs", "piece"]) expect(toBase(6, u)).toEqual({ amount: 6, unit: "pc" });
    for (const u of ["pack", "glasses", "", null, undefined]) expect(toBase(1, u)).toBeNull();
  });

  it("packsFor rounds up to whole packs, and is null when the two cannot be compared", () => {
    expect(packsFor(1.2, "kg", 500, "g")).toBe(3); expect(packsFor(2, "pc", 500, "g")).toBeNull();
    expect(packsFor(1, "kg", 500, "g")).toBe(2);
    expect(packsFor(1.1, "kg", 100, "g")).toBe(11);
    expect(packsFor(2, "l", 0.5, "l")).toBe(4);
    expect(packsFor(5, "pcs", 6, "pc")).toBe(1);
    expect(packsFor(1, "pack", 500, "g")).toBeNull();
    expect(packsFor(1, "kg", null, "g")).toBeNull();
    expect(packsFor(1, "kg", 0, "g")).toBeNull();
  });
});

describe("remember_product", () => {
  const milk = { item: "Milk", app: "zepto", product_id: "z-101", name_on_app: "Amul Taaza Toned Milk", pack: "500 ml", pack_amount: 500, pack_unit: "ml", price: 29, image: "https://img.example/milk.jpg" };

  it("rememberProduct keeps one product per item and app, and productFor finds it however the item is written", async () => {
    const { kit, rows } = await boot();
    const first = rememberProduct(kit.db, milk);
    expect(first).toMatchObject({ ...milk, item: "milk", updated_by: "app" });
    // The same product sent again: the details not given stay.
    expect(rememberProduct(kit.db, { item: "milk", app: "zepto", product_id: "z-101", name_on_app: "Amul Taaza Milk", price: 30 }))
      .toMatchObject({ id: first.id, name_on_app: "Amul Taaza Milk", pack: "500 ml", pack_amount: 500, pack_unit: "ml", price: 30, image: milk.image });
    // Another product takes its place whole: none of the old product's pack, price or image is kept.
    const second = rememberProduct(kit.db, { item: " MILK ", app: "zepto", product_id: "z-202", name_on_app: "Nandini Milk" });
    expect(second).toMatchObject({ id: first.id, item: "milk", product_id: "z-202", name_on_app: "Nandini Milk", pack: null, pack_amount: null, pack_unit: null, price: null, image: null });
    expect(packsFor(1, "l", second.pack_amount, second.pack_unit)).toBeNull();
    rememberProduct(kit.db, { ...milk, app: "bigbasket", product_id: "bb-9" });
    expect(rows("products").map((p) => [p.item, p.app, p.product_id])).toEqual([["milk", "zepto", "z-202"], ["milk", "bigbasket", "bb-9"]]);
    expect(productFor(kit.db, "Milk", "bigbasket")!.product_id).toBe("bb-9");
    expect(productFor(kit.db, "milk", "zomato-blinkit")).toBeNull();
    expect(productFor(kit.db, "curd", "zepto")).toBeNull();
  });

  it("a pack given as text alone is read into its amount and measure when it is plain, and left without a size otherwise", async () => {
    const { kit } = await boot();
    expect(parsePack("500 ml")).toEqual({ amount: 500, unit: "ml" });
    expect(parsePack(" 5 KG ")).toEqual({ amount: 5, unit: "kg" });
    expect(parsePack("1.5l")).toEqual({ amount: 1.5, unit: "l" });
    expect(parsePack("6 pcs")).toEqual({ amount: 6, unit: "pcs" });
    for (const p of ["1 pack", "2 x 500 ml", "500", "ml", "0 g", "", null, undefined]) expect(parsePack(p)).toBeNull();
    const p = (pack: string, more: object = {}) => rememberProduct(kit.db, { item: "atta", app: "zepto", product_id: "a-1", name_on_app: "Aashirvaad Atta", pack, ...more });
    expect(p("5 kg")).toMatchObject({ pack: "5 kg", pack_amount: 5, pack_unit: "kg" });
    expect(packsFor(7, "kg", 5, "kg")).toBe(2);
    // The pack text changed to one that cannot be read: the old size is not kept.
    expect(p("2 x 500 g")).toMatchObject({ pack: "2 x 500 g", pack_amount: null, pack_unit: null });
    // A size sent with the text is kept as sent; the same unreadable text sent again keeps it.
    expect(p("2 x 500 g", { pack_amount: 1000, pack_unit: "g" })).toMatchObject({ pack_amount: 1000, pack_unit: "g" });
    expect(p("2 x 500 g")).toMatchObject({ pack_amount: 1000, pack_unit: "g" });
    expect(p("1 kg")).toMatchObject({ pack_amount: 1, pack_unit: "kg" });
    // A new product with a pack that cannot be read has no size.
    expect(rememberProduct(kit.db, { item: "bread", app: "zepto", product_id: "b-1", name_on_app: "Bread", pack: "1 pack" })).toMatchObject({ pack_amount: null, pack_unit: null });
  });

  it("refuses a product it cannot read", async () => {
    const { op, rows } = await boot();
    for (const bad of [{ ...milk, item: "" }, { ...milk, app: "amazon" }, { ...milk, app: undefined }, { ...milk, product_id: undefined }, { ...milk, product_id: " " },
      { ...milk, name_on_app: undefined }, { ...milk, pack_amount: "500" }, { ...milk, pack_amount: 0 }, { ...milk, price: -1 }, { ...milk, price: "29" }, { ...milk, pack: 500 }])
      expect([bad, (await op("remember_product", bad)).code]).toEqual([bad, "APP_REFUSED"]);
    expect(rows("products")).toEqual([]);
    // An id that is a number on the app is kept as text.
    expect((await op("remember_product", { ...milk, product_id: 101 })).product.product_id).toBe("101");
  });

  it("remember_product upserts per item and app; import_order_history remembers products and only suggests", async () => {
    const { op, rows } = await boot();
    const a = await op("remember_product", milk);
    expect(a.product).toMatchObject({ item: "milk", app: "zepto", product_id: "z-101", pack_amount: 500, pack_unit: "ml", price: 29, updated_by: "agent:meal-agent" });
    const b = await op("remember_product", { ...milk, item: "milk", product_id: "z-102", price: 31 });
    expect(b.product).toMatchObject({ id: a.product.id, product_id: "z-102", price: 31 });
    await op("remember_product", { ...milk, app: "swiggy-instamart", product_id: "s-5" });
    expect(rows("products")).toHaveLength(2);

    const day = (i: number) => addDays("2026-10-01", i);
    const orders = [
      ...[0, 1, 2, 3].map((i) => ({ date: day(i), items: [
        { item: "Amul Taaza Milk", qty: 2, pack: "500 ml", product_id: i < 3 ? "z-old" : "z-new", price: 28 + i, ...(i < 3 ? { image: "https://img.example/old.jpg" } : {}) },
        { item: "Coriander", qty: 1 }] })),
      { date: day(5), items: [{ item: "Britannia Bread", qty: 1, pack: "400 g", product_id: 7001, name_on_app: "Britannia 100% Whole Wheat Bread" }] }];
    const r = await op("import_order_history", { app: "zepto", orders });
    expect(r.suggestions).toEqual([
      { item: "amul taaza milk", amount: 2, unit: "500 ml", every: "day", orders_seen: 4 },
      { item: "coriander", amount: 1, unit: null, every: "day", orders_seen: 4 }]);
    // Items that came with a product id are remembered, the newest order's product kept; the others are not.
    const zepto = rows("products").filter((p) => p.app === "zepto");
    expect(zepto.map((p) => p.item).sort()).toEqual(["amul taaza milk", "britannia bread", "milk"]);
    expect(zepto.find((p) => p.item === "amul taaza milk")).toMatchObject({ product_id: "z-new", name_on_app: "Amul Taaza Milk", pack: "500 ml", pack_amount: 500, pack_unit: "ml", price: 31, image: null, updated_by: "agent:meal-agent" });
    expect(zepto.find((p) => p.item === "britannia bread")).toMatchObject({ product_id: "7001", name_on_app: "Britannia 100% Whole Wheat Bread", pack: "400 g", pack_amount: 400, pack_unit: "g" });
    expect(rows("products")).toHaveLength(4);
    // It never makes an everyday item: the family confirms each one, and the agent sets it.
    expect(rows("regulars")).toEqual([]);
    // The same history again changes the rows it wrote, and adds none.
    await op("import_order_history", { app: "zepto", orders });
    expect(rows("products")).toHaveLength(4);
  });

  it("import_order_history refuses a history it cannot read, and remembers none of it", async () => {
    const { op, rows } = await boot();
    const good = { date: "2026-10-01", items: [{ item: "Milk", product_id: "z-1" }] };
    for (const bad of [{ app: "amazon", orders: [good] }, { app: "zepto" }, { app: "zepto", orders: [{ ...good, date: "last week" }] },
      { app: "zepto", orders: [good, { date: "2026-10-02" }] }, { app: "zepto", orders: [good, { date: "2026-10-02", items: [{ qty: 1 }] }] },
      { app: "zepto", orders: [good, { date: "2026-10-02", items: [{ item: "Curd", qty: "two" }] }] },
      { app: "zepto", orders: [good, { date: "2026-10-02", items: [{ item: "Curd", product_id: "z-2", price: "40" }] }] }])
      expect([bad, (await op("import_order_history", bad)).code]).toEqual([bad, "APP_REFUSED"]);
    expect(rows("products")).toEqual([]);
    expect((await op("import_order_history", { app: "zepto", orders: [] })).suggestions).toEqual([]);
  });
});
