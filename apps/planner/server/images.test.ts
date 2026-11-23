// Product pictures: an item's picture is the shopping app's own (an order's item, else the first cart line that had one),
// stored on the item and on the product, and served to the Pantry and Shopping pages; never one that is not a link. The guide
// tells the agent where to take it from. Today is Saturday 21 Nov 2026, noon.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { boot } from "./testkit";

const ATTA_OLD = "https://cdn.zeptonow.com/atta-old.png", ATTA_NEW = "https://cdn.zeptonow.com/atta-new.png";
const GHEE = "https://instamart-media-assets.swiggy.com/ghee.png", DAL = "https://cdn.zeptonow.com/dal.png";

const start = async () => {
  let t = new Date(2026, 10, 21, 12).getTime();
  const k = await boot({ now: () => new Date(t) });
  await k.op("set_shopping_apps", { main: "zepto", fallback: null, connected: ["zepto", "swiggy-instamart"] });
  return Object.assign(k, { later: (minutes: number) => { t += minutes * 60_000; } });
};
type K = Awaited<ReturnType<typeof start>>;
const item = (k: K, name: string) => k.rows("items").find((i) => i.item === name);
const pantry = async (k: K) => (await k.owner("GET", "/api/pantry")).body.rows as { name: string; image: string | null }[];
const zeptoCart = async (k: K) => ((await k.owner("GET", "/api/carts")).body.carts as any[]).find((c) => c.app === "zepto" && c.status === "open");

describe("product pictures", () => {
  it("import_order_history keeps each item's picture, the newest order's, with or without a product id, and the Pantry shows it", async () => {
    const k = await start();
    const r = await k.op("import_order_history", { app: "zepto", orders: [
      { date: "2026-10-01", order_ref: "Z1", items: [{ item: "atta", group: "monthly", product: "Aashirvaad Atta 5 kg", product_id: "z-atta", image: ATTA_OLD }] },
      { date: "2026-11-01", order_ref: "Z2", items: [{ item: "atta", group: "monthly", product: "Aashirvaad Atta 5 kg", product_id: "z-atta", image: ATTA_NEW },
        { item: "toor dal", group: "monthly", image: DAL }, { item: "salt", group: "monthly", image: "not a link" }] }] });
    expect(r.recorded).toBe(4);
    expect(item(k, "atta").image).toBe(ATTA_NEW);
    expect(item(k, "toor dal").image).toBe(DAL);
    expect(item(k, "salt").image).toBeNull();
    // Per product too.
    expect(k.rows("products").find((p) => p.product_id === "z-atta").image).toBe(ATTA_NEW);
    expect((await pantry(k)).map((p) => [p.name, p.image])).toEqual([["atta", ATTA_NEW], ["salt", null], ["toor dal", DAL]]);
  });

  it("an item never ordered keeps the picture of the first cart line that had one; the cart line shows it", async () => {
    const k = await start();
    await k.op("set_item", { item: "ghee", group: "monthly" });
    await k.op("set_cart_line", { item: "ghee", qty: 1, app: "swiggy-instamart", product_id: "im-ghee", name_on_app: "Amul Ghee 1 l", image: GHEE });
    expect(item(k, "ghee").image).toBe(GHEE);
    // A later line's picture does not take its place.
    await k.op("set_cart_line", { item: "ghee", qty: 1, app: "swiggy-instamart", image: "https://instamart-media-assets.swiggy.com/other.png" });
    expect(item(k, "ghee").image).toBe(GHEE);
    expect((await pantry(k)).find((p) => p.name === "ghee")!.image).toBe(GHEE);
  });

  it("a line with no picture of its own shows its product's, else its item's; an item first bought through a cart keeps its line's", async () => {
    const k = await start();
    await k.op("remember_product", { item: "curd", app: "zepto", product_id: "z-curd", name_on_app: "Mother Dairy curd", pack: "400 g", image: "https://cdn.zeptonow.com/curd.png" });
    await k.op("import_order_history", { app: "swiggy-instamart", orders: [{ date: "2026-11-10", order_ref: "I1", items: [{ item: "dal", group: "monthly", image: DAL }] }] });
    await k.op("set_cart_line", { item: "curd", qty: 1 });
    await k.op("set_cart_line", { item: "dal", qty: 1, app: "zepto" });
    await k.op("set_cart_line", { item: "paneer", qty: 1, product_id: "z-paneer", name_on_app: "Amul paneer", image: "https://cdn.zeptonow.com/paneer.png" });
    const lines = (await zeptoCart(k)).lines.map((l: any) => [l.item, l.image]);
    expect(lines).toEqual([["curd", "https://cdn.zeptonow.com/curd.png"], ["dal", DAL], ["paneer", "https://cdn.zeptonow.com/paneer.png"]]);
    // Paneer has no item yet; once the cart is ordered and placed, the item is made with the line's picture.
    expect(item(k, "paneer")).toBeUndefined();
    const id = (await zeptoCart(k)).order_id;
    await k.owner("POST", "/api/carts/zepto/order", {});
    await k.op("record_order", { order_id: id, placed: true });
    expect(item(k, "paneer").image).toBe("https://cdn.zeptonow.com/paneer.png");
  });

  it("the Pantry falls back to a remembered product's picture, and to none", async () => {
    const k = await start();
    await k.op("set_item", { item: "milk", group: "daily" });
    await k.op("set_item", { item: "eggs", group: "few_days" });
    await k.op("remember_product", { item: "milk", app: "zepto", product_id: "z-milk", name_on_app: "Amul Taaza", image: "https://cdn.zeptonow.com/milk.png" });
    expect((await pantry(k)).map((p) => [p.name, p.image])).toEqual([["eggs", null], ["milk", "https://cdn.zeptonow.com/milk.png"]]);
  });

  it("the guide tells the agent to pass the product's picture from the order details, and never in a message", () => {
    const guide = readFileSync(join(import.meta.dir, "agent-guide.md"), "utf8");
    expect(guide).toContain("`image`: the product's picture link exactly as the order's details give it (Zepto's order detail, Instamart's order items)");
    expect(guide).toContain("never one you made or searched for");
    expect(guide).toContain("never in a message");
  });
});
