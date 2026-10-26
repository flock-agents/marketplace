// Amazon skill: read-products and read-variants. The variant table and the card builder (offline), and
// the in-page reader against saved Amazon.in pages (fixtures/, trimmed to what the reader reads,
// gzipped). Amazon changes its pages often: when a live read comes back thin (a script's `health` or
// `note`), save the page again (fixtures/README.md), see which test fails, and add the new source as one
// more fallback.
//
// Run: bun test tests/amazon. The page and card-schema tests need a Flock checkout (playwright-core
// and the ProductCards component): FLOCK_APP_DIR=<flock>/flock-app bun test tests/amazon.
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { gunzipSync } from "zlib";
import { toItem, toVariantsItem, toBlock, fitResult, type PageRead } from "../../skills/amazon/scripts/_cards";
import { variantsOf, onScreen, sameSize, variantFor, otherOptions, planReads, sizesOf, ownSize, type Twister } from "../../skills/amazon/scripts/_variants";
import { readProductPageSource, readSearchPageSource } from "../../skills/amazon/scripts/_product-read";

const fixture = (name: string) => gunzipSync(readFileSync(join(import.meta.dir, "fixtures", `${name}.html.gz`))).toString("utf8");
const blockSpec = (block: string) => JSON.parse(block.replace(/^```flock-ui\n/, "").replace(/\n```$/, ""));

// A shirt in 3 colours × 3 sizes; Grey 38 is not sold, and on screen (Grey 40) Amazon marks 42 sold out.
const shirt: Twister = {
  dims: ["size_name", "color_name"],
  values: { size_name: ["38", "40", "42"], color_name: ["Aqua", "Grey", "White"] },
  map: { "0_0": "B000000A38", "1_0": "B000000A40", "2_0": "B000000A42", "1_1": "B000000G40", "2_1": "B000000G42", "0_2": "B000000W38", "1_2": "B000000W40", "2_2": "B000000W42" },
  selected: { size_name: 1, color_name: 1 },
  states: { size_name: { "38": "UNAVAILABLE", "40": "SELECTED", "42": "UNAVAILABLE" } },
};

describe("the variant table", () => {
  it("lists every variant sold, by colour then size, each with its ASIN", () => {
    const all = variantsOf(shirt);
    expect(all.length).toBe(8);
    expect(all[0]).toEqual({ asin: "B000000A38", size: "38", colour: "Aqua" });
    expect(all.some((v) => v.colour === "Grey" && v.size === "38")).toBe(false);
    expect(onScreen(shirt)).toEqual({ colour: "Grey", size: "40" });
  });

  it("matches a size however Amazon writes it", () => {
    for (const [a, b] of [["M", "Medium"], ["2XL", "XX-Large"], ["XXL", "2XL"], ["40", "40 cm"], ["UK 9", "9"], ["L", "l"]]) expect(sameSize(a, b)).toBe(true);
    for (const [a, b] of [["M", "L"], ["40", "42"], ["S", "XS"], ["9", "9.5"]]) expect(sameSize(a, b)).toBe(false);
  });

  it("shows the owner's size in the colour on screen; else a colour that has it; null when none does", () => {
    expect(variantFor(shirt, "40", "B000000G40")?.asin).toBe("B000000G40");
    expect(variantFor(shirt, "38", "B000000G40")?.asin).toBe("B000000A38");   // no Grey 38
    expect(variantFor(shirt, "42", "B000000G40")?.asin).toBe("B000000A42");   // Grey 42 marked sold out
    expect(variantFor(shirt, "44", "B000000G40")).toBeNull();
    expect(variantFor(shirt, undefined, "B000000G40")?.asin).toBe("B000000G40");
  });

  it("the owner's size in several systems: the first this product sells wins", () => {
    const letters: Twister = { ...shirt, values: { size_name: ["S", "M", "L"], color_name: ["Aqua", "Grey", "White"] } };
    expect(variantFor(letters, ["40", "M"], "B000000G40")).toMatchObject({ asin: "B000000G40", size: "M" });
    expect(variantFor(shirt, ["40", "M"], "B000000G40")).toMatchObject({ asin: "B000000G40", size: "40" });
    expect(variantFor(letters, ["40"], "B000000G40")).toBeNull();
    expect(sizesOf(["40", " M "])).toEqual(["40", "M"]);
    expect(sizesOf("40")).toEqual(["40"]);
    expect(sizesOf(undefined)).toEqual([]);
    expect(ownSize(letters, ["40", "Medium"])).toBe("M");
  });

  it("counts the other colours and sizes for the card's button", () => {
    expect(otherOptions(shirt, { asin: "B000000G40", colour: "Grey", size: "40" })).toEqual({ colours: 2, sizes: 2 });
  });

  it("plans whole colours only, the shown one first: no colour half read", () => {
    const shown = { asin: "B000000G40", colour: "Grey", size: "40" };
    expect(planReads(shirt, { size: "40", shown }).reads.length).toBe(8);
    const few = planReads(shirt, { size: "40", shown, cap: 6 });
    expect(few.colours).toEqual(["Grey", "Aqua"]);            // Grey (2) + Aqua (3); White (3) does not fit
    expect(few.reads.length).toBe(5);
    expect(few.coloursAll).toBe(3);
    const one = planReads(shirt, { size: "42", shown, cap: 1 });  // a first colour bigger than the cap: the owner's size first
    expect(one.reads.map((v) => v.asin)).toEqual(["B000000G40"]);
  });
});

const page = (over: Partial<PageRead> = {}): PageRead => ({
  asin: "B000000G40", title: "Allen Solly shirt", brand: "Allen Solly", price: 909, mrp: 1699, stock: "In stock",
  delivery: "Free Tomorrow", photos: ["p1", "p2", "p3", "p4", "p5"], rating: { stars: 3.7, count: 18642 }, bullets: ["a", "b", "c", "d"], ...over,
});

describe("cards", () => {
  it("a product is its one variant, read from its own page, with what else Amazon sells counted", () => {
    const { item } = toItem(page(), { asin: "B000000G40", colour: "Grey", size: "40" }, shirt);
    expect(item.colours).toEqual([{ name: "Grey", photos: [{ image: "p1" }, { image: "p2" }, { image: "p3" }, { image: "p4" }] }]);
    expect(item.sizes).toEqual(["40"]);
    expect(item.variants).toEqual([{ id: "B000000G40", colour: "Grey", size: "40", price: 909, mrp: 1699, delivery: "Free Tomorrow", stock: "In stock", available: true }]);
    expect(item.moreOptions).toEqual({ colours: 2, sizes: 2 });
    expect(item.bullets.length).toBe(3);
  });

  it("no variants on Amazon: photos on the item, no button", () => {
    const { item } = toItem(page({ asin: "B00NHQFA1I" }), null);
    expect(item.photos.length).toBe(4);
    expect(item.variants).toEqual([{ id: "B00NHQFA1I", price: 909, mrp: 1699, delivery: "Free Tomorrow", stock: "In stock", available: true }]);
    expect(item.moreOptions).toBeUndefined();
  });

  it("no title or no price: not shown, and says why", () => {
    expect(toItem(page({ title: undefined }), null)).toEqual({ reason: "no title" });
    expect(toItem(page({ price: undefined }), null)).toEqual({ reason: "no price" });
  });

  it("every variant read: each priced from its own page; a sold-out page is unavailable; an unread one is left off", () => {
    const plan = planReads(shirt, { size: "40", shown: { asin: "B000000G40", colour: "Grey", size: "40" } });
    const reads = new Map<string, PageRead>([
      ["B000000G40", page()],
      ["B000000G42", page({ asin: "B000000G42", price: undefined, stock: "Currently unavailable" })],
      ["B000000A40", page({ asin: "B000000A40", price: 986, photos: ["a1"] })],
      ["B000000W40", page({ asin: "B000000W40", price: 660 })],
    ]);
    const { item } = toVariantsItem(page(), "B000000G40", plan, reads, shirt);
    const byId = Object.fromEntries(item.variants.map((v: any) => [v.id, v]));
    expect(byId.B000000A40.price).toBe(986);
    expect(byId.B000000W40.price).toBe(660);
    expect(byId.B000000G42).toMatchObject({ available: false, stock: "Currently unavailable" });
    expect(byId.B000000W38).toBeUndefined();                       // not read: not on the card
    expect(item.colours.map((c: any) => c.name)).toEqual(["Grey", "Aqua", "White"]);
    expect(item.colours[1].photos).toEqual([{ image: "a1" }]);      // each colour's photos from its own page
    expect(item.sizes).toEqual(["40", "42"]);
    expect(item.id).toBe("B000000G40");
  });

  it("past 8 colours, the rest are counted for the card's link", () => {
    const asinOf = (i: number) => `B0000000${String(i).padStart(2, "0")}`;
    const many: Twister = { dims: ["color_name"], values: { color_name: Array.from({ length: 11 }, (_, i) => `C${i}`) }, map: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`${i}`, asinOf(i)])) };
    const plan = planReads(many, {});
    const reads = new Map(plan.reads.map((v) => [v.asin, page({ asin: v.asin })] as [string, PageRead]));
    const { item } = toVariantsItem(page(), plan.reads[0].asin, plan, reads, many);
    expect(item.colours.length).toBe(8);
    expect(item.moreColours).toBe(3);
  });

  it("pickedSize only when a product sells that size", () => {
    const { item } = toItem(page(), { asin: "B000000G40", colour: "Grey", size: "40" }, shirt);
    expect(blockSpec(toBlock([item], { size: "40" })).children[0].props.pickedSize).toBe("40");
    expect(blockSpec(toBlock([item], { size: "44" })).children[0].props.pickedSize).toBeUndefined();
  });
});

describe("the answer reaches the agent whole", () => {
  it("10 products with long reads fit under the limit, trimming extras, never a variant or a price", () => {
    const items = Array.from({ length: 10 }, (_, i) => toItem(page({ asin: `B00000000${i}`, title: "T".repeat(190), details: "D".repeat(1500), bullets: ["B".repeat(160), "B".repeat(160), "B".repeat(160)], photos: Array.from({ length: 4 }, (_, k) => `https://m.media-amazon.com/images/I/${"x".repeat(40)}${k}.jpg`) }), { asin: `B00000000${i}`, colour: "Grey", size: "40" }, shirt).item);
    const opts = { size: "40" };
    const result = fitResult({ block: toBlock(items, opts), shown: 10, skipped: [], health: items.map((it) => ({ asin: it.id, missing: [] })) }, items, opts);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(20000);
    const spec = blockSpec(result.block!);
    expect(spec.children[0].props.items.length).toBe(10);
    expect(spec.children[0].props.items.every((it: any) => it.variants.length === 1 && it.variants[0].price === 909)).toBe(true);
  });
});

const appDir = process.env.FLOCK_APP_DIR;
const playwrightPath = appDir ? join(appDir, "node_modules", "playwright-core") : "";
const canBrowse = !!appDir && existsSync(playwrightPath);

describe.skipIf(!canBrowse)("the in-page reader on saved Amazon.in pages (scripts off, as read)", () => {
  let browser: any, tab: any;
  beforeAll(async () => {
    const { chromium } = await import(playwrightPath);
    browser = await chromium.launch({ channel: "chrome", headless: true });
    // The page's own scripts stay off: only the reader runs, against the HTML as Amazon sent it.
    tab = await (await browser.newContext({ javaScriptEnabled: false })).newPage();
  });
  afterAll(async () => { await browser?.close(); });
  const read = async (name: string, src: string) => {
    await tab.setContent(fixture(name), { waitUntil: "domcontentloaded" });
    return JSON.parse(await tab.evaluate(src));
  };

  it("search: organic results first, each ASIN once", async () => {
    const s = await read("search-lounge-shorts", readSearchPageSource);
    expect(s.results.length).toBeGreaterThanOrEqual(10);
    expect(s.organic).toBeGreaterThan(0);
    expect(new Set(s.results.map((r: any) => r.asin)).size).toBe(s.results.length);
    expect(s.captcha).toBe(false);
  });

  it("a sized shirt: its variant table, and the right variant for each size (live 2026-10-26: sizes shown sold out)", async () => {
    const r = await read("dp-B07DMZDRV4-sized-shirt", readProductPageSource);
    expect(r.price).toBe(909);
    const t: Twister = r.twister;
    expect(t.values.size_name).toEqual(["38", "39", "40", "42", "44"]);
    expect(onScreen(t)).toEqual({ colour: "Grey", size: "40" });
    expect(variantFor(t, "40", "B07DMZDRV4")?.asin).toBe("B07DMZDRV4");
    expect(variantFor(t, "42", "B07DMZDRV4")).toMatchObject({ asin: "B07DMX4XHP", colour: "Grey", size: "42" });
    expect(variantFor(t, "38", "B07DMZDRV4")?.colour).not.toBe("Grey");   // Grey has no 38
    expect(otherOptions(t, variantFor(t, "40", "B07DMZDRV4")!)).toEqual({ colours: 10, sizes: 4 });
  });

  it("clothes with colours and sizes: the gallery and the table", async () => {
    const r = await read("dp-B0C2YCBW9Y-colours-sizes", readProductPageSource);
    expect(r.asin).toBe("B0C2YCBW9Y");
    expect(r.title).toContain("Jockey MV20");
    expect(r.brand).toBe("Jockey");
    expect(r.price).toBe(1599);
    expect(r.rating).toEqual({ stars: 4.2, count: 117 });
    expect(r.photos.length).toBe(4);
    expect(variantsOf(r.twister).length).toBe(40);
    expect(onScreen(r.twister)).toEqual({ colour: "Black", size: "M" });
  });

  it("a product with no variants: its gallery, M.R.P. and badge, no table", async () => {
    const r = await read("dp-B00NHQFA1I-no-variants", readProductPageSource);
    expect(r.title).toContain("LEGO Classic");
    expect(r.price).toBe(2238);
    expect(r.mrp).toBe(3199);
    expect(r.badge).toBe("Amazon's Choice");
    expect(r.twister).toBeUndefined();
  });

  it("the M.R.P. is the price block's, never a recommendation's further down", async () => {
    const r = await read("dp-B0B8CK31NT-mrp", readProductPageSource);
    expect(r.price).toBe(305);
    expect(r.mrp).toBe(399);
  });

  const uiDef = appDir ? join(appDir, "packages", "ui", "src", "components", "ProductCards", "ProductCards.def.ts") : "";
  it.skipIf(!uiDef || !existsSync(uiDef))("cards built from these pages pass the ProductCards schema", async () => {
    const { ProductCardsDef } = await import(uiDef);
    const items = [];
    for (const name of ["dp-B07DMZDRV4-sized-shirt", "dp-B0C2YCBW9Y-colours-sizes", "dp-B00NHQFA1I-no-variants", "dp-B0B8CK31NT-mrp"]) {
      const r = await read(name, readProductPageSource);
      if (!r.asin) r.asin = name.split("-")[1];   // read-products takes it from the page's address
      const v = r.twister ? variantFor(r.twister, "40", r.asin) ?? variantFor(r.twister, undefined, r.asin) : null;
      const { item, reason } = toItem(r, v, r.twister);
      expect(reason).toBeUndefined();
      items.push(item);
    }
    const props = blockSpec(toBlock(items, { size: "40" })).children[0].props;
    const res = ProductCardsDef.props.safeParse({ ...props, onSubmit: () => {} });
    expect(res.success ? "ok" : JSON.stringify(res.error.issues.slice(0, 3))).toBe("ok");
  });
});
