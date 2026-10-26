// Amazon skill, read-products: the card builder (offline) and the in-page reader against saved Amazon.in
// pages (fixtures/, trimmed to what the reader reads, gzipped). Amazon changes its pages often: when a
// live read comes back thin (read-products' `health` and `note`), save the page again
// (fixtures/README.md), see which test fails, and add the new source as one more fallback.
//
// Run: bun test tests/amazon. The page and card-schema tests need a Flock checkout (playwright-core
// and the ProductCards component): FLOCK_APP_DIR=<flock>/flock-app bun test tests/amazon.
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { gunzipSync } from "zlib";
import { toItem, toBlock, type PageRead } from "../../skills/amazon/scripts/_cards";
import { readProductPageSource, readSearchPageSource } from "../../skills/amazon/scripts/_product-read";

const fixture = (name: string) => gunzipSync(readFileSync(join(import.meta.dir, "fixtures", `${name}.html.gz`))).toString("utf8");
const blockSpec = (block: string) => JSON.parse(block.replace(/^```flock-ui\n/, "").replace(/\n```$/, ""));

const shorts: PageRead = {
  asin: "B0C2YCBW9Y", title: "Jockey MV20 Shorts", brand: "Jockey", price: 1599, delivery: "Free Wednesday, 28 October", stock: "In stock",
  rating: { stars: 4.2, count: 117 }, bullets: ["Recycled microfiber"], photos: ["https://m.media-amazon.com/images/I/a.jpg"],
  colours: [{ name: "Black", photos: [{ image: "https://m.media-amazon.com/images/I/a.jpg" }] }, { name: "Navy", photos: [{ image: "https://m.media-amazon.com/images/I/n.jpg" }] }],
  sizes: ["S", "M"],
  variants: [
    { id: "B0C2YD5N7M", colour: "Black", size: "S", available: true },
    { id: "B0C2YCBW9Y", colour: "Black", size: "M", available: true },
    { id: "B0C2YCNFWS", colour: "Navy", size: "S", price: 1499, available: true },
  ],
  current: { colour: "Black", size: "M" }, found: [], missing: ["mrp"],
};

describe("toItem: a page read becomes a card, only with what was read", () => {
  it("puts the page's price, delivery and stock on the variant on screen; its colour's other sizes take its price", () => {
    const { item } = toItem(shorts, "B0C2YCBW9Y");
    const byId = Object.fromEntries(item.variants.map((v: any) => [v.id, v]));
    expect(byId.B0C2YCBW9Y).toEqual({ id: "B0C2YCBW9Y", colour: "Black", size: "M", available: true, price: 1599, delivery: "Free Wednesday, 28 October", stock: "In stock" });
    expect(byId.B0C2YD5N7M.price).toBe(1599);
    expect(byId.B0C2YCNFWS.price).toBe(1499);          // its own swatch price stays
    expect(byId.B0C2YCNFWS.delivery).toBeUndefined();  // never another variant's delivery
    expect(item.colours.map((c: any) => c.name)).toEqual(["Black", "Navy"]);
    expect(item.sizes).toEqual(["S", "M"]);
    expect(item.url).toBe("https://www.amazon.in/dp/B0C2YCBW9Y");
    expect(item.mrp).toBeUndefined();
  });

  it("a product sold in neither colours nor sizes is one variant with its photos on the item", () => {
    const { item } = toItem({ asin: "B00NHQFA1I", title: "LEGO box", price: 2238, mrp: 3199, photos: ["u1", "u2", "u3", "u4", "u5"], stock: "In stock" }, "B00NHQFA1I");
    expect(item.photos).toEqual([{ image: "u1" }, { image: "u2" }, { image: "u3" }, { image: "u4" }]);
    expect(item.variants).toEqual([{ id: "B00NHQFA1I", price: 2238, mrp: 3199, stock: "In stock", available: true }]);
  });

  it("a sold-out stock line marks the variant unavailable", () => {
    const { item } = toItem({ asin: "B00NHQFA1I", title: "LEGO box", price: 2238, stock: "Currently unavailable" }, "B00NHQFA1I");
    expect(item.variants[0].available).toBe(false);
  });

  it("no title or no price: not shown, and says why (never a guessed card)", () => {
    expect(toItem({ asin: "B00NHQFA1I", price: 100 }, "B00NHQFA1I")).toEqual({ reason: "no title" });
    expect(toItem({ asin: "B00NHQFA1I", title: "x" }, "B00NHQFA1I")).toEqual({ reason: "no price" });
    expect(toItem({ ...shorts, price: undefined, variants: shorts.variants!.map((v) => ({ ...v, price: undefined })) }, "B0C2YCBW9Y")).toEqual({ reason: "no price" });
    expect(toItem({ title: "x", price: 1 }, "not-an-asin")).toEqual({ reason: "no ASIN" });
  });

  it("keeps to the card's limits: 10 sizes, 48 variants, 3 bullets", () => {
    const sizes = Array.from({ length: 12 }, (_, i) => `S${i}`);
    const variants = Array.from({ length: 8 }, (_, c) => sizes.map((s, i) => ({ id: `B0000000${c}${i % 10}`.slice(0, 10), colour: `C${c}`, size: s, price: 10, available: true }))).flat();
    const { item } = toItem({ asin: "B0000000AA", title: "t", price: 10, sizes, variants, colours: Array.from({ length: 8 }, (_, c) => ({ name: `C${c}`, photos: [] })), bullets: ["a1", "b2", "c3", "d4"] }, "B0000000AA");
    expect(item.sizes.length).toBe(10);
    expect(item.variants.length).toBe(48);
    expect(item.variants.every((v: any) => item.sizes.includes(v.size))).toBe(true);
    expect(item.bullets.length).toBe(3);
  });
});

describe("toBlock", () => {
  it("one MiniApp holding one ProductCards; pickedSize only when a product sells that size", () => {
    const { item } = toItem(shorts, "B0C2YCBW9Y");
    const spec = blockSpec(toBlock([item], { title: "Lounge shorts", size: "M" }));
    expect(spec.type).toBe("MiniApp");
    expect(spec.props.title).toBe("Lounge shorts");
    expect(spec.children[0].type).toBe("ProductCards");
    expect(spec.children[0].props.pickedSize).toBe("M");
    expect(blockSpec(toBlock([item], { size: "XXXL" })).children[0].props.pickedSize).toBeUndefined();
  });
});

const appDir = process.env.FLOCK_APP_DIR;
const playwrightPath = appDir ? join(appDir, "node_modules", "playwright-core") : "";
const canBrowse = !!appDir && existsSync(playwrightPath);

describe.skipIf(!canBrowse)("the in-page reader on saved Amazon.in pages (scripts off, as read)", () => {
  let browser: any, page: any;
  beforeAll(async () => {
    const { chromium } = await import(playwrightPath);
    browser = await chromium.launch({ channel: "chrome", headless: true });
    // The page's own scripts stay off: only the reader runs, against the HTML as Amazon sent it.
    page = await (await browser.newContext({ javaScriptEnabled: false })).newPage();
  });
  afterAll(async () => { await browser?.close(); });
  const read = async (name: string, src: string) => {
    await page.setContent(fixture(name), { waitUntil: "domcontentloaded" });
    return JSON.parse(await page.evaluate(src));
  };

  it("search: organic results first, each ASIN once", async () => {
    const s = await read("search-lounge-shorts", readSearchPageSource);
    expect(s.results.length).toBeGreaterThanOrEqual(10);
    expect(s.organic).toBeGreaterThan(0);
    expect(new Set(s.results.map((r: any) => r.asin)).size).toBe(s.results.length);
    expect(s.results.every((r: any) => /^[A-Z0-9]{10}$/.test(r.asin))).toBe(true);
    expect(s.captcha).toBe(false);
  });

  it("clothes: every colour and size, a variant per pair sold, the gallery of the colour on screen", async () => {
    const r = await read("dp-B0C2YCBW9Y-colours-sizes", readProductPageSource);
    expect(r.asin).toBe("B0C2YCBW9Y");
    expect(r.title).toContain("Jockey MV20");
    expect(r.brand).toBe("Jockey");
    expect(r.price).toBe(1599);
    expect(r.rating).toEqual({ stars: 4.2, count: 117 });
    expect(r.bullets.length).toBe(3);
    expect(r.photos.length).toBe(4);
    expect(r.colours.length).toBe(8);
    expect(r.colours[0].name).toBe("Black");          // the colour on screen first
    expect(r.sizes).toEqual(["S", "M", "L", "XL", "2XL"]);
    expect(r.variants.length).toBe(40);
    expect(r.current).toEqual({ colour: "Black", size: "M" });
    expect(r.missing).not.toContain("price");
  });

  it("a product with no variants: its gallery, M.R.P. and badge", async () => {
    const r = await read("dp-B00NHQFA1I-no-variants", readProductPageSource);
    expect(r.title).toContain("LEGO Classic");
    expect(r.price).toBe(2238);
    expect(r.mrp).toBe(3199);
    expect(r.badge).toBe("Amazon's Choice");
    expect(r.photos.length).toBe(4);
    expect(r.variants).toBeUndefined();
  });

  it("the M.R.P. is the price block's, never a recommendation's further down", async () => {
    const r = await read("dp-B0B8CK31NT-mrp", readProductPageSource);
    expect(r.price).toBe(305);
    expect(r.mrp).toBe(399);
    expect(r.variants.length).toBe(8);
  });

  const uiDef = appDir ? join(appDir, "packages", "ui", "src", "components", "ProductCards", "ProductCards.def.ts") : "";
  it.skipIf(!uiDef || !existsSync(uiDef))("every block built from these pages passes the ProductCards schema", async () => {
    const { ProductCardsDef } = await import(uiDef);
    const items = [];
    // read-products passes each page's ASIN from its address (/dp/<ASIN>); a saved page has none.
    for (const name of ["dp-B0C2YCBW9Y-colours-sizes", "dp-B00NHQFA1I-no-variants", "dp-B0B8CK31NT-mrp"]) {
      const r = await read(name, readProductPageSource);
      const { item, reason } = toItem(r, name.split("-")[1]);
      expect(reason).toBeUndefined();
      items.push(item);
    }
    const props = blockSpec(toBlock(items, { size: "M" })).children[0].props;
    const res = ProductCardsDef.props.safeParse({ ...props, onSubmit: () => {} });
    expect(res.success ? "ok" : JSON.stringify(res.error.issues.slice(0, 3))).toBe("ok");
  });
});
