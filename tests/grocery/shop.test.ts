// Grocery website skills (bigbasket, zepto, zomato-blinkit): the shared shop module (_shop.ts) —
// address matching, the bill with every fee, the cart-page check — and its in-page scripts run on
// stand-in pages: hand-made pages with the shops' markup as the scripts expect it and made-up
// data, NOT saved copies of the real sites. A real-site run is still what confirms the selectors.
//
// Run: bun test tests/grocery. The page tests need a Flock checkout (playwright-core):
// FLOCK_APP_DIR=<flock>/flock-app bun test tests/grocery.
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  matchAddress, summarizeBill, notTheCart, locationShows,
  cartReadScript, emptyCartScript, addressScript,
  type SavedAddress, type ShopSite,
} from "../../skills/bigbasket/scripts/_shop";
import { BIGBASKET } from "../../skills/bigbasket/scripts/_bigbasket";

const skills = join(import.meta.dir, "../../skills");

describe("the shared shop files", () => {
  it("are the same in every grocery website skill", () => {
    for (const file of ["_shop.ts", "_shop_run.ts"]) {
      const bb = readFileSync(join(skills, "bigbasket/scripts", file), "utf8");
      for (const skill of ["zepto", "zomato-blinkit"]) expect(readFileSync(join(skills, skill, "scripts", file), "utf8")).toBe(bb);
    }
  });

  it("every function the manifest allows has a script, and each new one is documented", () => {
    for (const skill of ["bigbasket", "zepto", "zomato-blinkit"]) {
      const manifest = JSON.parse(readFileSync(join(skills, skill, "flock.skill.json"), "utf8"));
      const doc = readFileSync(join(skills, skill, "instructions.md"), "utf8");
      for (const fn of manifest.security.allowedFunctions) expect(existsSync(join(skills, skill, "scripts", `${fn}.ts`))).toBe(true);
      for (const fn of ["list-addresses", "set-delivery-location", "empty-cart", "view-cart"]) {
        expect(manifest.security.allowedFunctions).toContain(fn);
        expect(doc).toContain(`### ${fn}`);
      }
      expect(doc).not.toContain("api/internal/skill-exec");
    }
  });
});

const saved: SavedAddress[] = [
  { index: 0, label: "Home", text: "Home 12 Lake Road, HAL 2nd Stage, Indiranagar, Bengaluru 560038", selected: false },
  { index: 1, label: "Work", text: "Work Floor 4, Northwind Tower, Outer Ring Road, Bellandur, Bengaluru 560103", selected: true },
  { index: 2, label: "Parents", text: "Parents 7 Temple Street, Jayanagar, Bengaluru 560041", selected: false },
];

describe("matchAddress", () => {
  it("finds the agreed address by its text, however it is written", () => {
    expect(matchAddress(saved, "12 Lake Road, Indiranagar, Bengaluru 560038")).toMatchObject({ ok: true, address: { index: 0 } });
    expect(matchAddress(saved, "7 temple st jayanagar")).toMatchObject({ ok: true, address: { index: 2 } });
  });

  it("finds it by a label only one saved address carries", () => {
    expect(matchAddress(saved, "Home")).toMatchObject({ ok: true, address: { index: 0 } });
  });

  it("never takes an address in another pincode, or an office for a home", () => {
    expect(matchAddress(saved, "12 Lake Road, Indiranagar, Bengaluru 560008")).toMatchObject({ ok: false, code: "ADDRESS_NOT_SAVED" });
    expect(matchAddress([saved[1]], "12 Lake Road, Indiranagar")).toMatchObject({ ok: false, code: "ADDRESS_NOT_SAVED" });
  });

  it("is ambiguous, never a guess, when two saved addresses fit", () => {
    const twoHomes = [saved[0], { ...saved[2], label: "Home", text: "Home 7 Temple Street, Jayanagar, Bengaluru 560041" }];
    const result = matchAddress(twoHomes, "Home");
    expect(result).toMatchObject({ ok: false, code: "AMBIGUOUS_ADDRESS" });
    expect(result.ok ? [] : result.candidates.length).toBe(2);
  });

  it("is not saved when nothing is given or nothing is saved", () => {
    expect(matchAddress(saved, "")).toMatchObject({ ok: false, code: "ADDRESS_NOT_SAVED" });
    expect(matchAddress([], "Home")).toMatchObject({ ok: false, code: "ADDRESS_NOT_SAVED" });
  });

  it("checks the header now shows the chosen address", () => {
    expect(locationShows("Delivery in 9 minutes Indiranagar, Bengaluru", saved[0])).toBe(true);
    expect(locationShows("Delivery in 9 minutes Bellandur", saved[0])).toBe(false);
  });
});

describe("summarizeBill", () => {
  it("takes the page's own total to pay, with the fees listed", () => {
    const totals = summarizeBill([
      { label: "Item total", amount: 240 },
      { label: "Delivery fee", amount: 0 },
      { label: "Handling charge", amount: 9 },
      { label: "Small cart fee", amount: 15 },
      { label: "Grand total", amount: 264 },
    ], 240);
    expect(totals).toMatchObject({ subtotal: 240, feeTotal: 24, total: 264, totalSource: "page" });
    expect(totals.fees.map((f) => f.label)).toEqual(["Delivery fee", "Handling charge", "Small cart fee"]);
  });

  it("adds every fee and takes off a coupon when the page shows no total", () => {
    const totals = summarizeBill([{ label: "Platform fee", amount: 5 }, { label: "Delivery charges", amount: 30 }, { label: "Coupon discount", amount: 20 }], 200);
    expect(totals).toMatchObject({ subtotal: 200, feeTotal: 35, discount: 20, total: 215, totalSource: "computed" });
  });
});

describe("notTheCart", () => {
  const read = { pageUrl: "https://www.bigbasket.com/basket/", cartShown: false, emptyShown: false, headerText: "", items: [{ name: "Milk", quantity: 1, price: 27, href: "" }], bill: [] };
  const blinkit: ShopSite = { ...BIGBASKET, cartPath: undefined, cartShown: ".drawer", cartHeader: ".cart-button" };

  it("passes the cart page and refuses any other page", () => {
    expect(notTheCart(BIGBASKET, read)).toBeNull();
    expect(notTheCart(BIGBASKET, { ...read, pageUrl: "https://www.bigbasket.com/" })).toContain("not BigBasket's cart page");
    expect(notTheCart(BIGBASKET, { ...read, items: [] })).toContain("not a readable");
    expect(notTheCart(BIGBASKET, { ...read, items: [], emptyShown: true })).toBeNull();
  });

  it("a drawer cart: only an open drawer, or a header that says the cart is empty", () => {
    expect(notTheCart(blinkit, { ...read, cartShown: true })).toBeNull();
    expect(notTheCart(blinkit, { ...read, headerText: "2 items ₹120" })).toContain("did not open");
    expect(notTheCart(blinkit, { ...read, items: [], headerText: "My Cart" })).toBeNull();
    expect(notTheCart(blinkit, { ...read, items: [], headerText: "" })).toContain("did not open");
  });
});

// ---- Stand-in pages -------------------------------------------------------------------------

const BASKET = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header><div class="AddressDropdown">Delivery in 2 hrs · Indiranagar</div></header>
<main>
  <div class="BasketItem"><a href="/pd/40000001/fresho-tomato/">x</a><h3 class="name">Fresho Tomato 1 kg</h3><span class="qty">2</span><span class="price">₹40</span><button class="remove">Remove</button></div>
  <div class="BasketItem"><a href="/pd/40000002/amul-milk/">x</a><h3 class="name">Amul Taaza Milk 500 ml</h3><span class="qty">1</span><span class="price">₹27</span><button class="remove">Remove</button></div>
  <section class="bill">
    <div class="row"><span>Sub Total</span><span>₹107</span></div>
    <div class="row"><span>Delivery Charges</span><span><s>₹30</s> FREE</span></div>
    <div class="row"><span>Handling fee</span><span>₹9</span></div>
    <div class="row"><span>Total Payable</span><span>₹116</span></div>
  </section>
</main>
<script>
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".remove"); if (!btn) return;
    setTimeout(() => { btn.closest(".BasketItem").remove(); if (!document.querySelector(".BasketItem")) { document.querySelector(".bill").remove(); document.querySelector("main").insertAdjacentHTML("beforeend", "<p>Your basket is empty</p>"); } }, 200);
  });
</script></body></html>`;

/** What blinkit.com/cart shows: the home page, with suggestion cards and a header cart button. */
const HOME_WITH_SUGGESTIONS = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header><div class="LocationBar__Container">Delivery in 9 minutes · Bellandur</div><div class="CartButton__Button">2 items ₹120</div></header>
<main><div class="Product__Card"><div class="name">Lay's Classic Salted</div><div class="price">₹20</div><div class="price">Item total ₹20</div></div></main>
</body></html>`;

const BLINKIT_DRAWER = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header><div class="CartButton__Button">2 items ₹120</div></header>
<div class="CartWrapper__CartContainer" style="display:none">
  <div class="CartProduct__Container"><div class="DefaultProductCard__ProductTitle">Amul Butter 100 g</div><div class="DefaultProductCard__Price">₹56</div>
    <div class="AddToCart__UpdatedButtonContainer"><span class="AddMinusIcon">U</span>1<span class="AddMinusIcon">5</span></div></div>
  <div class="CartProduct__Container"><div class="DefaultProductCard__ProductTitle">Britannia Bread 400 g</div><div class="DefaultProductCard__Price">₹32</div>
    <div class="AddToCart__UpdatedButtonContainer"><span class="AddMinusIcon">U</span>2<span class="AddMinusIcon">5</span></div></div>
</div>
<script>
  document.querySelector(".CartButton__Button").addEventListener("click", () => { document.querySelector(".CartWrapper__CartContainer").style.display = "block"; });
  document.addEventListener("click", (e) => {
    const icon = e.target.closest(".AddMinusIcon"); if (!icon || icon !== icon.parentElement.firstElementChild) return;
    const stepper = icon.parentElement; const qty = parseInt(stepper.childNodes[1].textContent, 10) - 1;
    setTimeout(() => {
      if (qty > 0) stepper.childNodes[1].textContent = String(qty); else stepper.closest(".CartProduct__Container").remove();
      const n = document.querySelectorAll(".CartProduct__Container").length;
      document.querySelector(".CartButton__Button").textContent = n ? n + " items" : "My Cart";
    }, 150);
  });
</script></body></html>`;

const ADDRESS_PICKER = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header><div class="LocationBar__Container">Delivery in 9 minutes · Bellandur</div></header>
<div role="dialog" style="display:none">
  <button>+ Add a new address</button>
  <div class="AddressList">
    <div class="AddressItem"><div class="AddressItem__label">Home</div><div class="AddressItem__text">12 Lake Road, HAL 2nd Stage, Indiranagar, Bengaluru 560038</div></div>
    <div class="AddressItem AddressItem--selected"><div class="AddressItem__label">Work</div><div class="AddressItem__text">Floor 4, Northwind Tower, Bellandur, Bengaluru 560103</div></div>
  </div>
</div>
<script>
  const dialog = document.querySelector('[role="dialog"]');
  document.querySelector(".LocationBar__Container").addEventListener("click", () => { dialog.style.display = "block"; });
  dialog.addEventListener("click", (e) => {
    const item = e.target.closest(".AddressItem"); if (!item) return;
    const area = item.querySelector(".AddressItem__text").textContent.split(",")[2].trim();
    document.querySelector(".LocationBar__Container").textContent = "Delivery in 9 minutes · " + area;
    dialog.style.display = "none";
  });
</script></body></html>`;

const appDir = process.env.FLOCK_APP_DIR;
const playwrightPath = appDir ? join(appDir, "node_modules", "playwright-core") : "";
const canBrowse = !!appDir && existsSync(playwrightPath);

describe.skipIf(!canBrowse)("the in-page scripts on stand-in pages", () => {
  let browser: any;
  beforeAll(async () => {
    const { chromium } = await import(playwrightPath);
    browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }));
  });
  afterAll(async () => { await browser?.close(); });

  /** Serves `html` at `url` (nothing leaves the machine), runs the page actions' click if any, then `script`. */
  async function run(url: string, html: string, script: string, before?: string): Promise<any> {
    const tab = await browser.newPage();
    try {
      await tab.route("**/*", (route: any) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
      await tab.goto(url);
      if (before) await tab.evaluate(before);
      return JSON.parse(await tab.evaluate(script));
    } finally { await tab.close(); }
  }

  const blinkit: ShopSite = {
    ...BIGBASKET,
    cartPath: undefined,
    cartShown: '[class*="CartWrapper__CartContainer"], [class*="CartProduct__Container"]',
    cartHeader: '[class*="CartButton__Button"], [class*="CartButton"]',
    cartLines: '[class*="CartProduct__Container"]',
    removeControls: '[class*="AddToCart__UpdatedButtonContainer"] [class*="AddMinusIcon"]',
    addressOpeners: ['[class*="LocationBar__Container"]'],
  };
  const openDrawer = `document.querySelector('[class*="CartButton__Button"]').click()`;

  it("reads a cart page: its lines and every fee, FREE delivery as 0, the page's total", async () => {
    const read = await run("https://www.bigbasket.com/basket/", BASKET, cartReadScript(BIGBASKET));
    expect(notTheCart(BIGBASKET, read)).toBeNull();
    expect(read.items.map((i: any) => [i.name, i.quantity, i.price, BIGBASKET.productId(i.href)])).toEqual([
      ["Fresho Tomato 1 kg", 2, 40, "40000001"],
      ["Amul Taaza Milk 500 ml", 1, 27, "40000002"],
    ]);
    expect(summarizeBill(read.bill, 107)).toMatchObject({ subtotal: 107, feeTotal: 9, total: 116, totalSource: "page" });
  });

  it("refuses the home page and its suggestions as the cart (what blinkit.com/cart shows)", async () => {
    const asBasket = await run("https://www.bigbasket.com/", HOME_WITH_SUGGESTIONS, cartReadScript(BIGBASKET));
    expect(notTheCart(BIGBASKET, asBasket)).toContain("not BigBasket's cart page");
    const asDrawer = await run("https://blinkit.com/cart", HOME_WITH_SUGGESTIONS, cartReadScript(blinkit));
    expect(notTheCart(blinkit, asDrawer)).toContain("did not open");
  });

  it("empties a cart page by each line's remove, and says what it removed", async () => {
    const out = await run("https://www.bigbasket.com/basket/", BASKET, emptyCartScript(BIGBASKET));
    expect(out).toMatchObject({ remaining: 0, emptyShown: true, removed: ["Fresho Tomato 1 kg", "Amul Taaza Milk 500 ml"] });
  });

  it("empties Blinkit's drawer with the stepper's minus, every unit", async () => {
    const out = await run("https://blinkit.com/", BLINKIT_DRAWER, emptyCartScript(blinkit), openDrawer);
    expect(out).toMatchObject({ remaining: 0, headerText: "My Cart", removed: ["Amul Butter 100 g", "Britannia Bread 400 g"] });
    expect(notTheCart(blinkit, { ...out, items: [], bill: [] })).toBeNull();
  });

  it("lists the saved addresses from the header's picker, skipping 'Add a new address'", async () => {
    const out = await run("https://blinkit.com/", ADDRESS_PICKER, addressScript(blinkit, null));
    expect(out.saved.map((a: SavedAddress) => [a.label, a.selected])).toEqual([["Home", false], ["Work", true]]);
    expect(out.location).toContain("Bellandur");
  });

  it("selects the matching saved address and the header follows", async () => {
    const tab = await browser.newPage();
    try {
      await tab.route("**/*", (route: any) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: ADDRESS_PICKER }));
      await tab.goto("https://blinkit.com/");
      const listed = JSON.parse(await tab.evaluate(addressScript(blinkit, null)));
      const match = matchAddress(listed.saved, "12 Lake Road, Indiranagar, Bengaluru 560038");
      expect(match.ok).toBe(true);
      const picked = JSON.parse(await tab.evaluate(addressScript(blinkit, match.ok ? match.address.index : -1)));
      expect(picked.location).toContain("Indiranagar");
      expect(locationShows(picked.location, picked.selected)).toBe(true);
    } finally { await tab.close(); }
  });
});
