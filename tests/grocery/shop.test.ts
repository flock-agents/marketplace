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
  cartReadScript, emptyCartScript, addressListScript, selectAddress, noSavedAddresses,
  type PageStep, type SavedAddress, type ShopSite,
} from "../../skills/bigbasket/scripts/_shop";
import { BIGBASKET, searchScript, addFromSearchScript } from "../../skills/bigbasket/scripts/_bigbasket";
import { BLINKIT_SITE } from "../../skills/zomato-blinkit/scripts/_blinkit";

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

describe("BigBasket search-products", () => {
  it("waits for the cards in its page script, so a search with none is not a step timeout", () => {
    const run = readFileSync(join(skills, "bigbasket/scripts/search-products.ts"), "utf8");
    expect(run).not.toContain("waitForSelector");
    expect(run).toContain("searchScript(maxResults)");
    expect(run).toContain("note: NO_CARDS_NOTE");
  });

  it("add-to-cart adds from the search results when given the query, without the product page", () => {
    const add = readFileSync(join(skills, "bigbasket/scripts/add-to-cart.ts"), "utf8");
    expect(add).toContain("if (query) await addFromSearch(query);");
    expect(add).toContain("addFromSearchScript(productId, quantity)");
  });
});

const saved: SavedAddress[] = [
  { index: 0, label: "Home", text: "Home 12 Lake Road, HAL 2nd Stage, Indiranagar, Bengaluru 560038", selected: false },
  { index: 1, label: "Work", text: "Work Floor 4, Northwind Tower, Outer Ring Road, Bellandur, Bengaluru 560103", selected: true },
  { index: 2, label: "Parents", text: "Parents 7 Temple Street, Jayanagar, Bengaluru 560041", selected: false },
];

/** One home as two shops store it: with a block letter and no pincode, and with a floor, a block and another pincode. */
const homeNoPin: SavedAddress = { index: 0, label: "Home", text: "B204, B Block Lotus Grove Residency, Varthur Main Rd, Whitefield, Bengaluru, Karnataka", selected: false };
const homeOtherPin: SavedAddress = { index: 1, label: "Home", text: "B204, 2nd Floor, Block B, Lotus Grove Residency, Whitefield, Bangalore, 560066", selected: false };
const office: SavedAddress = { index: 2, label: "Work", text: "Floor 6, Northwind Tech Park, Outer Ring Rd, Marathahalli, Bengaluru 560037", selected: true };

describe("matchAddress", () => {
  it("finds the agreed address by its flat or house number and building, however it is written", () => {
    expect(matchAddress(saved, "12 Lake Road, Indiranagar, Bengaluru 560038")).toMatchObject({ ok: true, address: { index: 0 } });
    expect(matchAddress(saved, "7 temple st jayanagar")).toMatchObject({ ok: true, address: { index: 2 } });
    expect(matchAddress([homeNoPin, office], "B-204, Lotus Grove Residency, Whitefield")).toMatchObject({ ok: true, address: { index: 0 } });
  });

  it("a different or missing pincode alone does not reject it", () => {
    expect(matchAddress(saved, "12 Lake Road, Indiranagar, Bengaluru 560008")).toMatchObject({ ok: true, address: { index: 0 } });
    expect(matchAddress([homeNoPin, office], "B204, Lotus Grove Residency, Varthur Road, Bengaluru 560087")).toMatchObject({ ok: true, address: { index: 0 } });
    expect(matchAddress([homeOtherPin, office], "B204 Lotus Grove Residency Whitefield 560087")).toMatchObject({ ok: true, address: { index: 1 } });
  });

  it("never matches on the label alone", () => {
    expect(matchAddress(saved, "Home")).toMatchObject({ ok: false, code: "ADDRESS_NOT_SAVED" });
    expect(matchAddress([homeNoPin, office], "Home")).toMatchObject({ ok: false, code: "ADDRESS_NOT_SAVED" });
    expect(matchAddress([homeNoPin, office], "Work")).toMatchObject({ ok: false, code: "ADDRESS_NOT_SAVED" });
  });

  it("never takes another flat, the same flat number in another building, or an office for a home", () => {
    expect(matchAddress([homeNoPin], "B205, Lotus Grove Residency, Whitefield")).toMatchObject({ ok: false, code: "ADDRESS_NOT_SAVED" });
    expect(matchAddress([homeNoPin], "B204, Maple Heights, Whitefield")).toMatchObject({ ok: false, code: "ADDRESS_NOT_SAVED" });
    expect(matchAddress([saved[1]], "12 Lake Road, Indiranagar")).toMatchObject({ ok: false, code: "ADDRESS_NOT_SAVED" });
  });

  it("takes the building alone when the flat number is left out", () => {
    expect(matchAddress([homeNoPin, office], "Lotus Grove Residency, Whitefield")).toMatchObject({ ok: true, address: { index: 0 } });
    expect(matchAddress([homeNoPin, office], "Whitefield, Bengaluru")).toMatchObject({ ok: false, code: "ADDRESS_NOT_SAVED" });
  });

  it("is ambiguous, never a guess, when two saved addresses match equally", () => {
    const result = matchAddress([homeNoPin, homeOtherPin, office], "B204, Lotus Grove Residency, Bengaluru 560087");
    expect(result).toMatchObject({ ok: false, code: "AMBIGUOUS_ADDRESS" });
    expect(result.ok ? [] : result.candidates.map((a) => a.index)).toEqual([0, 1]);
  });

  it("is not saved when nothing is given or nothing is saved", () => {
    expect(matchAddress(saved, "")).toMatchObject({ ok: false, code: "ADDRESS_NOT_SAVED" });
    expect(matchAddress([], "12 Lake Road, Indiranagar")).toMatchObject({ ok: false, code: "ADDRESS_NOT_SAVED" });
  });

  it("checks the header now shows the chosen address", () => {
    expect(locationShows("Delivery in 9 minutes Indiranagar, Bengaluru", saved[0])).toBe(true);
    expect(locationShows("Delivery in 9 minutes Bellandur", saved[0])).toBe(false);
    expect(locationShows("Delivery in 17 minutes Home B204, B Block Lotus Grove Residency, Whitefield", homeNoPin)).toBe(true);
  });

  it("a header showing another flat number, or only a city it showed before, is not the chosen address", () => {
    expect(locationShows("Delivery in 17 minutes Home 25, Varthur Main Rd, Koramangala, Bengaluru 560034, India", homeNoPin)).toBe(false);
    const before = "Delivery in 8 mins Work: Marathahalli, Bangalore";
    expect(locationShows(before, homeOtherPin, before)).toBe(false);
    expect(locationShows("Delivery in 8 mins Home: Whitefield, Bangalore", homeOtherPin, before)).toBe(true);
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

/** BigBasket's search page as checked live 2026-11-10: the card heading holds the rating between brand, name and pack. */
const BB_SEARCH = `<!doctype html><html><head><meta charset="utf-8"></head><body><main>
  <div class="SKUDeck___StyledDiv-sc-1e5d9gk-0"><a href="/pd/40000101/fresho-onion-1-kg/"><img src="https://img.example.test/onion.jpg"></a>
    <h3>fresho!<br>4.2<br>5122 Ratings<br>Onion<br>1 kg</h3><span>₹38</span> <span>₹47</span> <span>19% OFF</span><button>Add</button></div>
  <div class="SKUDeck___StyledDiv-sc-1e5d9gk-0"><a href="/pd/40000102/amul-butter/"><img src="https://img.example.test/butter.jpg"></a>
    <h3>Amul<br>Butter - Pasteurised<br>100 g</h3><span>₹56</span><button>Add</button></div>
</main></body></html>`;

/** BigBasket's search results with a working Add: it turns into a stepper (icon-only minus and plus) that counts. */
const BB_SEARCH_ADD = `<!doctype html><html><head><meta charset="utf-8"></head><body><main>
  <div class="SKUDeck___StyledDiv-sc-1"><a href="/pd/40000101/fresho-onion-1-kg/">x</a><h3>fresho!<br>Onion<br>1 kg</h3><span>₹38</span> <div class="atc"><button>Add</button></div></div>
  <div class="SKUDeck___StyledDiv-sc-1"><a href="/pd/40000102/amul-butter/">x</a><h3>Amul<br>Butter<br>100 g</h3><span>₹56</span> <div class="atc"><button>Notify Me</button></div><span>Out of Stock</span></div>
</main><script>
  let count = 0;
  const atc = document.querySelector(".atc");
  const draw = () => { atc.innerHTML = '<button aria-hidden="true"><svg></svg></button><span class="qty">' + count + '</span><button><svg></svg></button>'; };
  atc.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.textContent.trim() === "Add") { count = 1; return setTimeout(draw, 100); }
    if (b === atc.lastElementChild) { count++; setTimeout(draw, 100); }
  });
</script></body></html>`;

/** A search BigBasket has no groceries for: no product cards at all. */
const BB_NO_RESULTS = `<!doctype html><html><head><meta charset="utf-8"></head><body><main><h2>Oops! No results found for "laptop"</h2></main></body></html>`;

/** Blinkit's picker as utility classes only: a fixed overlay with no dialog role, entries with no "address"
 *  class, and a handler that answers mousedown (not a bare click) on the entry's wrapper. */
const BLINKIT_UTILITY_PICKER = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header><div class="flex cursor-pointer"><div class="font-bold">Delivery in 9 minutes</div><div class="text-sm">Bellandur, Bengaluru</div></div></header>
<div id="overlay" class="fixed inset-0 z-50" style="position:fixed;top:0;left:0;width:100%;height:100%;display:none">
  <div class="p-4">
    <div class="font-bold">Change Location</div>
    <button class="rounded">Detect my location</button>
    <input placeholder="search delivery location">
    <div class="text-xs">Your saved addresses</div>
    <div class="flex gap-2 cursor-pointer" tabindex="0" data-area="Indiranagar"><div><div class="font-semibold">Home</div><div class="text-xs">12 Lake Road, HAL 2nd Stage, Indiranagar, Bengaluru 560038</div></div></div>
    <div class="flex gap-2 cursor-pointer" tabindex="0" data-area="Bellandur"><div><div class="font-semibold">Work</div><div class="text-xs">Floor 4, Northwind Tower, Bellandur, Bengaluru 560103</div></div></div>
  </div>
</div>
<script>
  const overlay = document.getElementById("overlay");
  document.querySelector("header .cursor-pointer").addEventListener("click", () => { overlay.style.display = "block"; });
  for (const entry of overlay.querySelectorAll("[data-area]")) entry.addEventListener("mousedown", () => {
    document.querySelector("header .text-sm").textContent = entry.dataset.area + ", Bengaluru";
    overlay.style.display = "none";
  });
</script></body></html>`;

type Entry = { label: string; address: string; area: string };
const HOME_ENTRY: Entry = { label: "Home", address: "B204, B Block Lotus Grove Residency, Varthur Main Rd, Whitefield, Bengaluru, Karnataka", area: "Whitefield" };
const WORK_ENTRY: Entry = { label: "Work", address: "Floor 6, Northwind Tech Park, Outer Ring Rd, Marathahalli, Bengaluru, Karnataka", area: "Marathahalli" };

/**
 * Blinkit's header and saved-address picker in the shapes captured live (2026-11-11), made-up data:
 * the header's LocationBar shows "Home" over another place (another flat, as live); each entry is an
 * outer AddressListItem__AddressDetails holding the label, an inner AddressDetails with the address
 * (no pincode) and an edit icon. The picker's container was not captured: a plain fixed div here.
 * Picking sets the header to the entry's address; the edit icon opens an editor instead; Escape closes.
 */
const blinkitPicker = (entries: Entry[]) => `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header><div class="LocationBar__Container-sc-x8ezho-6 kPzFcd"><div class="LocationBar__EtaContainer-sc-x8ezho-7">
  <div class="LocationBar__Title-sc-x8ezho-8">Delivery in 17 minutes</div>
  <div class="LocationBar__SubtitleContainer-sc-x8ezho-9"><div class="LocationBar__AddressLabel-sc-x8ezho-10">Home</div><div class="LocationBar__Subtitle-sc-x8ezho-11">25, Varthur Main Rd, Koramangala, Bengaluru 560034, India</div><div class="LocationBar__ArrowContainer-sc-x8ezho-12"><div class="LocationBar__DownArrow-sc-x8ezho-13"></div></div></div>
</div></div></header>
<div id="picker" style="display:none;position:fixed;top:0;left:0;width:420px;height:100%;background:#fff">
  <div>Change Location</div><button>Detect my location</button>
  ${entries.map((e, i) => `<div class="AddressListItem__Container-sc-wi2msz-1" data-i="${i}"><div class="AddressListItem__AddressDetails-sc-wi2msz-3" style="display:flex">
    <div class="AddressListItem__AddressLabel-sc-wi2msz-4">${e.label}</div><div class="AddressListItem__AddressDetails-sc-wi2msz-3" style="flex:1">${e.address}</div><div class="AddressListItem__AddressEditIcon-sc-wi2msz-5" style="width:24px">✎</div>
  </div></div>`).join("")}
</div>
<script>
  const entries = ${JSON.stringify(entries)};
  const picker = document.getElementById("picker");
  window.edited = false;
  document.querySelector('[class*="LocationBar__Container"]').addEventListener("click", () => { picker.style.display = "block"; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") picker.style.display = "none"; });
  picker.addEventListener("click", (e) => {
    if (e.target.closest('[class*="AddressEditIcon"]')) { window.edited = true; return; }
    const item = e.target.closest('[class*="AddressListItem__Container"]'); if (!item) return;
    const entry = entries[item.dataset.i];
    setTimeout(() => {
      document.querySelector('[class*="LocationBar__AddressLabel"]').textContent = entry.label;
      document.querySelector('[class*="LocationBar__Subtitle-"]').textContent = entry.address.replace(", Karnataka", " 560066, India");
      picker.style.display = "none";
    }, 300);
  });
</script></body></html>`;

/**
 * BigBasket's header and address menu in the shapes captured live (2026-11-11), made-up data: a Headless
 * UI menu button ("Delivery in 8 mins", "Work: Marathahalli, Bangalore") next to another menu button; the
 * open menu holds ul.overscroll-contain[role="none"] > li[role="menuitem"] > AddressCard (label, hr,
 * name, address). With `confirm`, picking asks "Change delivery address?" first (not captured live).
 */
const bigbasketMenu = (entries: Entry[], confirm = false) => `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header><nav>
  <button id="headlessui-menu-button-:r1:" aria-haspopup="menu" aria-expanded="false">Shop by Category</button>
  <div class="relative">
    <button id="headlessui-menu-button-:r3:" aria-haspopup="menu" aria-expanded="false" class="sc-fPrdXf hEaOJL"><span class="Label-sc-15v1nk5-0"><span>Delivery in 8 mins</span></span><span><span class="font-bold capitalize">Work:&nbsp;</span><span id="area">Marathahalli, Bangalore</span></span></button>
    <div role="menu" hidden><ul class="overscroll-contain" role="none">
      ${entries.map((e, i) => `<li class="m-2 outline-none" role="menuitem" data-i="${i}"><div class="AddressCard___StyledDiv-sc-1udrslf-0"><span class="font-bold capitalize text-base truncate">${e.label}</span><hr/><div class="text-md leading-sm"><span class="line-clamp-1">Asha Rao</span><span class="line-clamp-4">${e.address.replace(", Karnataka", ", 560066").replace("Bengaluru", "Bangalore")}</span></div></div></li>`).join("")}
    </ul></div>
  </div>
</nav></header>
<div id="confirm" role="dialog" hidden><p>Change delivery address? Items in your basket may change.</p><button>Cancel</button><button id="yes">Confirm</button></div>
<script>
  const entries = ${JSON.stringify(entries)};
  const button = document.getElementById("headlessui-menu-button-:r3:");
  const menu = document.querySelector('[role="menu"]');
  const show = (open) => { menu.hidden = !open; button.setAttribute("aria-expanded", String(open)); };
  let pending = null;
  const apply = (entry) => { button.querySelector(".font-bold").innerHTML = entry.label + ":&nbsp;"; document.getElementById("area").textContent = entry.area + ", Bangalore"; };
  button.addEventListener("click", () => show(menu.hidden));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") show(false); });
  menu.addEventListener("click", (e) => {
    const item = e.target.closest('[role="menuitem"]'); if (!item) return;
    show(false);
    const entry = entries[item.dataset.i];
    if (${confirm}) { pending = entry; document.getElementById("confirm").hidden = false; } else apply(entry);
  });
  document.getElementById("yes").addEventListener("click", () => { document.getElementById("confirm").hidden = true; apply(pending); });
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
    addressPicker: undefined,
    addressOpeners: ['[class*="LocationBar__Container"]'],
  };
  const openDrawer = `document.querySelector('[class*="CartButton__Button"]').click()`;

  it("BigBasket search reads each card's id, name and pack, skipping the rating lines", async () => {
    const out = await run("https://www.bigbasket.com/ps/?q=onion", BB_SEARCH, searchScript(10, 500));
    expect(out.products.map((p: any) => [p.id, p.name, p.quantity, p.price, p.mrp])).toEqual([
      ["40000101", "fresho! Onion", "1 kg", 38, 47],
      ["40000102", "Amul Butter - Pasteurised", "100 g", 56, null],
    ]);
  });

  it("BigBasket add-to-cart adds from the search results: the card's Add, then + for each more unit", async () => {
    const tab = await browser.newPage();
    try {
      await tab.route("**/*", (route: any) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: BB_SEARCH_ADD }));
      await tab.goto("https://www.bigbasket.com/ps/?q=onion");
      const out = JSON.parse(await tab.evaluate(addFromSearchScript("40000101", 3, 500)));
      expect(out).toMatchObject({ success: true, productId: "40000101", quantityAdded: 3, quantityAsked: 3 });
      expect(await tab.textContent(".qty")).toBe("3");
    } finally { await tab.close(); }
  });

  it("BigBasket add-to-cart says out of stock, or not in these results, without clicking anything else", async () => {
    const out = await run("https://www.bigbasket.com/ps/?q=butter", BB_SEARCH_ADD, addFromSearchScript("40000102", 1, 500));
    expect(out).toMatchObject({ error: true, code: "OUT_OF_STOCK" });
    const missing = await run("https://www.bigbasket.com/ps/?q=butter", BB_SEARCH_ADD, addFromSearchScript("49999999", 1, 300));
    expect(missing).toMatchObject({ error: true, code: "NOT_IN_RESULTS" });
  });

  it("BigBasket search with no product cards answers an empty list, not a timeout", async () => {
    const started = Date.now();
    const out = await run("https://www.bigbasket.com/ps/?q=laptop", BB_NO_RESULTS, searchScript(10, 500));
    expect(out).toEqual({ products: [], totalResults: 0, noCards: true });
    expect(Date.now() - started).toBeLessThan(4000);
  });

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
  }, 30_000); // each read waits out its own cart wait (up to 10s) on a page that never shows the cart

  it("empties a cart page by each line's remove, and says what it removed", async () => {
    const out = await run("https://www.bigbasket.com/basket/", BASKET, emptyCartScript(BIGBASKET));
    expect(out).toMatchObject({ remaining: 0, emptyShown: true, removed: ["Fresho Tomato 1 kg", "Amul Taaza Milk 500 ml"] });
  });

  it("empties Blinkit's drawer with the stepper's minus, every unit", async () => {
    const out = await run("https://blinkit.com/", BLINKIT_DRAWER, emptyCartScript(blinkit), openDrawer);
    expect(out).toMatchObject({ remaining: 0, headerText: "My Cart", removed: ["Amul Butter 100 g", "Britannia Bread 400 g"] });
    expect(notTheCart(blinkit, { ...out, items: [], bill: [] })).toBeNull();
  });

  /** Runs the page scripts in `tab` as set-delivery-location runs them in the signed-in browser. */
  const stepOn = (tab: any): PageStep => async (script, waitMs) => {
    if (waitMs) await tab.waitForTimeout(waitMs);
    try { return JSON.parse(await tab.evaluate(script)); } catch { return null; }
  };
  async function onPage<T>(url: string, html: string, body: (tab: any) => Promise<T>): Promise<T> {
    const tab = await browser.newPage();
    try {
      await tab.route("**/*", (route: any) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
      await tab.goto(url);
      return await body(tab);
    } finally { await tab.close(); }
  }
  const listOn = (site: ShopSite) => (tab: any) => tab.evaluate(addressListScript(site, true)).then(JSON.parse);

  it("Blinkit list-addresses opens the header's picker, reads each saved entry's label and address, and closes it", async () => {
    await onPage("https://blinkit.com/", blinkitPicker([HOME_ENTRY, WORK_ENTRY]), async (tab) => {
      const out = await listOn(BLINKIT_SITE)(tab);
      expect(out.opened).toBe(true);
      expect(out.saved.map((a: SavedAddress) => [a.label, a.text])).toEqual([["Home", HOME_ENTRY.address], ["Work", WORK_ENTRY.address]]);
      expect(out.location).toContain("Koramangala");
      expect(await tab.isVisible("#picker")).toBe(false);
    });
  });

  it("BigBasket list-addresses opens the address menu (not the other menu), reads each entry, and closes it", async () => {
    await onPage("https://www.bigbasket.com/", bigbasketMenu([HOME_ENTRY, WORK_ENTRY]), async (tab) => {
      const out = await listOn(BIGBASKET)(tab);
      expect(out.opened).toBe(true);
      expect(out.saved.map((a: SavedAddress) => [a.label, a.text])).toEqual([
        ["Home", "B204, B Block Lotus Grove Residency, Varthur Main Rd, Whitefield, Bangalore, 560066"],
        ["Work", "Floor 6, Northwind Tech Park, Outer Ring Rd, Marathahalli, Bangalore, 560066"],
      ]);
      expect(out.location).toContain("Work: Marathahalli");
      expect(await tab.getAttribute("#headlessui-menu-button-\\:r3\\:", "aria-expanded")).toBe("false");
      expect(await tab.getAttribute("#headlessui-menu-button-\\:r1\\:", "aria-expanded")).toBe("false");
    });
  });

  it("an opened picker with no saved entries reads none (NO_SAVED_ADDRESSES); a page without the control is NO_LOCATION_CONTROL", async () => {
    const none = await onPage("https://blinkit.com/", blinkitPicker([]), listOn(BLINKIT_SITE));
    expect(none).toMatchObject({ saved: [], opened: true });
    expect(noSavedAddresses(BLINKIT_SITE, none)).toMatchObject({ code: "NO_SAVED_ADDRESSES" });
    const bare = await onPage("https://www.bigbasket.com/", "<!doctype html><html><body><main>Hi</main></body></html>", listOn(BIGBASKET));
    expect(bare).toMatchObject({ error: true, code: "NO_LOCATION_CONTROL" });
  }, 30_000);

  it("Blinkit set-delivery-location: another pincode still matches by flat and building; it presses that entry (not its edit icon) and the header shows it", async () => {
    await onPage("https://blinkit.com/", blinkitPicker([WORK_ENTRY, HOME_ENTRY]), async (tab) => {
      const out = await selectAddress(BLINKIT_SITE, "B-204, Lotus Grove Residency, Varthur Road, Bengaluru 560087", stepOn(tab));
      expect(out).toMatchObject({ ok: true, address: { label: "Home", text: HOME_ENTRY.address }, confirmed: true, stillOpen: false });
      expect(out.ok && out.location).toContain("B204, B Block Lotus Grove Residency");
      expect(await tab.evaluate("window.edited")).toBe(false);
    });
  });

  it("BigBasket set-delivery-location picks the matching menu item and the header shows its area", async () => {
    await onPage("https://www.bigbasket.com/", bigbasketMenu([WORK_ENTRY, HOME_ENTRY]), async (tab) => {
      const out = await selectAddress(BIGBASKET, "B204, Lotus Grove Residency, Whitefield, Bengaluru 560087", stepOn(tab));
      expect(out).toMatchObject({ ok: true, address: { label: "Home" }, confirmed: true });
      expect(out.ok && out.location).toContain("Home: Whitefield");
    });
  });

  it("BigBasket set-delivery-location presses a 'change address?' confirm when one shows", async () => {
    await onPage("https://www.bigbasket.com/", bigbasketMenu([WORK_ENTRY, HOME_ENTRY], true), async (tab) => {
      const out = await selectAddress(BIGBASKET, "B204 Lotus Grove Residency", stepOn(tab));
      expect(out).toMatchObject({ ok: true, confirmed: true });
      expect(await tab.textContent("#area")).toBe("Whitefield, Bangalore");
      expect(await tab.isVisible("#confirm")).toBe(false);
    });
  });

  it("set-delivery-location clicks nothing for a label alone or for two equal matches", async () => {
    await onPage("https://www.bigbasket.com/", bigbasketMenu([WORK_ENTRY, HOME_ENTRY]), async (tab) => {
      const out = await selectAddress(BIGBASKET, "Home", stepOn(tab));
      expect(out).toMatchObject({ ok: false, code: "ADDRESS_NOT_SAVED" });
      expect(out.ok ? [] : out.candidates?.map((a) => a.label)).toEqual(["Work", "Home"]);
      expect(await tab.textContent("#area")).toBe("Marathahalli, Bangalore");
    });
    const sameHomeOtherPin = { ...HOME_ENTRY, address: HOME_ENTRY.address.replace("Karnataka", "560067") };
    await onPage("https://blinkit.com/", blinkitPicker([HOME_ENTRY, sameHomeOtherPin, WORK_ENTRY]), async (tab) => {
      const out = await selectAddress(BLINKIT_SITE, "B204, Lotus Grove Residency, Whitefield", stepOn(tab));
      expect(out).toMatchObject({ ok: false, code: "AMBIGUOUS_ADDRESS" });
      expect(out.ok ? 0 : out.candidates?.length).toBe(2);
      expect(await tab.textContent('[class*="LocationBar__Subtitle-"]')).toContain("Koramangala");
    });
  });

  it("the generic reader (a site not checked live) lists a picker by its address classes and selects one", async () => {
    await onPage("https://blinkit.com/", ADDRESS_PICKER, async (tab) => {
      const listed = JSON.parse(await tab.evaluate(addressListScript(blinkit, false)));
      expect(listed.saved.map((a: SavedAddress) => [a.label, a.selected])).toEqual([["Home", false], ["Work", true]]);
      expect(listed.location).toContain("Bellandur");
    });
    await onPage("https://blinkit.com/", ADDRESS_PICKER, async (tab) => {
      const out = await selectAddress(blinkit, "12 Lake Road, Indiranagar, Bengaluru 560038", stepOn(tab));
      expect(out).toMatchObject({ ok: true, address: { label: "Home" }, confirmed: true });
      expect(out.ok && out.location).toContain("Indiranagar");
    });
  });

  it("the generic reader on a picker of utility classes only: entries by their text, selected on mousedown", async () => {
    await onPage("https://blinkit.com/", BLINKIT_UTILITY_PICKER, async (tab) => {
      const out = await selectAddress({ ...BLINKIT_SITE, addressPicker: undefined }, "12 Lake Road, Indiranagar, Bengaluru 560038", stepOn(tab));
      expect(out).toMatchObject({ ok: true, address: { label: "Home" }, confirmed: true });
      expect(out.ok && out.location).toContain("Indiranagar");
    });
  });
});
