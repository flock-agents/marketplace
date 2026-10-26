/**
 * Amazon.in — what one product page holds, read in the page itself (no clicks).
 *
 * Amazon changes its pages often, so every field has more than one source, tried in order: the
 * data Amazon builds the page from (the twister's variationValues / dimensionToAsinMap /
 * colorImages, the gallery's colorImages 'initial') first, as it changes least; then several
 * selectors; then the page's own text. A field none of them finds is left out and named in
 * `missing`, never guessed, and one field failing never stops the others (each is read in its own
 * try). The function runs in the browser: it is sent as source (readProductPageSource), so it
 * uses nothing from outside its own body.
 */

/* eslint-disable */
export function readProductPage(): string {
  const out: any = { found: [], missing: [] };
  const take = (name: string, fn: () => any) => {
    let v: any;
    try { v = fn(); } catch (e) { v = undefined; }
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (empty) out.missing.push(name); else { out[name] = v; out.found.push(name); }
  };
  const clean = (t: any) => String(t == null ? "" : t).replace(/\s+/g, " ").trim();
  const textOf = (sels: string[]) => {
    for (const s of sels) {
      const el = document.querySelector(s);
      const t = el ? clean((el as any).innerText || el.textContent) : "";
      if (t) return t;
    }
    return "";
  };
  const money = (t: any) => {
    const s = clean(t);
    const m = s.match(/₹\s*([\d,]+(?:\.\d+)?)/) || s.match(/^([\d,]+(?:\.\d+)?)$/);
    if (!m) return undefined;
    const n = parseFloat(m[1].replace(/,/g, ""));
    return isFinite(n) && n > 0 ? n : undefined;
  };
  const moneyOf = (sels: string[]) => {
    for (const s of sels) {
      for (const el of Array.from(document.querySelectorAll(s)).slice(0, 3)) {
        const n = money((el as any).value || (el as any).innerText || el.textContent);
        if (n) return n;
      }
    }
    return undefined;
  };
  const scripts = Array.from(document.scripts).map((s) => s.textContent || "");
  const all = scripts.join("\n");
  // The JSON value after "key": in the page's scripts (an object or array, matched by brackets).
  const grab = (key: string) => {
    const at = all.indexOf('"' + key + '"');
    if (at < 0) return null;
    let i = at + key.length + 2;
    while (i < all.length && all[i] !== "{" && all[i] !== "[") { if (all[i] !== ":" && all[i] !== " ") return null; i++; }
    let depth = 0, str = false, esc = false;
    for (let j = i; j < all.length; j++) {
      const c = all[j];
      if (str) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') str = false; continue; }
      if (c === '"') str = true;
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") { depth--; if (depth === 0) { try { return JSON.parse(all.slice(i, j + 1)); } catch (e) { return null; } } }
    }
    return null;
  };
  const strAfter = (key: string) => {
    const m = all.match(new RegExp('"' + key + '"\\s*:\\s*"([^"]+)"'));
    return m ? m[1] : "";
  };

  take("asin", () => strAfter("currentAsin")
    || ((document.querySelector('input[name="ASIN"], input#ASIN') as any) || {}).value
    || ((location.pathname.match(/\/dp\/([A-Z0-9]{10})/) || [])[1]));
  take("title", () => textOf(["#productTitle", "#title", "h1"])
    || ((document.querySelector('meta[name="title"], meta[property="og:title"]') as any) || {}).content
    || clean(document.title).replace(/^Amazon\.in\s*:\s*/i, "").replace(/\s*:\s*Amazon\.in.*$/i, "").replace(/^Buy\s+/i, ""));
  take("brand", () => {
    const t = textOf(["#bylineInfo", "#brand", "a#bylineInfo"]);
    return t.replace(/^Visit the\s+/i, "").replace(/\s+Store$/i, "").replace(/^Brand:\s*/i, "").slice(0, 60);
  });
  take("price", () => moneyOf([
    "#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen",
    "#corePriceDisplay_desktop_feature_div .priceToPay",
    "#corePrice_feature_div .a-offscreen",
    "#apex_desktop .priceToPay .a-offscreen",
    "input#twister-plus-price-data-price",
    "#priceblock_dealprice", "#priceblock_ourprice",
    "#centerCol .a-price .a-offscreen",
  ]));
  // Only the price block's own M.R.P. (recommendations further down show other products' M.R.P.),
  // and only one above the price: the price-to-pay figure shares the a-text-price class.
  take("mrp", () => {
    const n = moneyOf([
      "#corePriceDisplay_desktop_feature_div .apex-basisprice-value .a-offscreen",
      "#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen",
      "#corePrice_feature_div .basisPrice .a-offscreen",
      "#apex_desktop .basisPrice .a-offscreen",
      "#priceblock_listprice",
    ]) || money((textOf(["#corePriceDisplay_desktop_feature_div", "#corePrice_feature_div", "#apex_desktop"]).match(/M\.R\.P\.?:?\s*₹\s*[\d,]+(?:\.\d+)?/) || [])[0]);
    return n && (!out.price || n > out.price) ? n : undefined;
  });
  take("rating", () => {
    const t = ((document.querySelector("#acrPopover") as any) || {}).title
      || textOf(["#acrPopover .a-icon-alt", "#averageCustomerReviews .a-icon-alt", '[data-hook="rating-out-of-text"]']);
    const stars = parseFloat((String(t).match(/(\d(?:\.\d)?)\s*out of\s*5/) || [])[1]);
    if (!isFinite(stars)) return undefined;
    const c = textOf(["#acrCustomerReviewText", '[data-hook="total-review-count"]']).replace(/[^\d]/g, "");
    return c ? { stars, count: parseInt(c, 10) } : { stars };
  });
  take("badge", () => {
    const t = textOf(["#acBadge_feature_div", "#zeitgeistBadge_feature_div", "#acBadge_feature_div .ac-badge-wrapper", ".badge-wrapper"]);
    if (/amazon'?s\s*choice/i.test(t)) return "Amazon's Choice";
    const best = t.match(/#\s?\d+\s+Best Seller/i);
    return best ? best[0].replace(/#\s?/, "#") : undefined;
  });
  take("bullets", () => {
    for (const s of ["#feature-bullets li span.a-list-item", "#feature-bullets li", "#productFactsDesktopExpander li span.a-list-item", "#productFactsDesktop_feature_div li"]) {
      const list = Array.from(document.querySelectorAll(s)).map((el) => clean((el as any).innerText || el.textContent)).filter((t) => t.length > 3 && !/^(see more|show more)/i.test(t));
      if (list.length) return list.slice(0, 3).map((t) => t.length > 160 ? t.slice(0, 157).replace(/\s+\S*$/, "") + "…" : t);
    }
    return undefined;
  });
  // A description shorter than a sentence ("MAX Lounge Shorts") says nothing the title does not.
  take("details", () => {
    const t = textOf(["#productDescription", "#bookDescription_feature_div"]);
    return t.length >= 40 ? t.slice(0, 1500) : undefined;
  });
  take("delivery", () => {
    const t = textOf(["#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE", "#deliveryBlockMessage", "#delivery-message", "#ddmDeliveryMessage"]);
    // The delivery date only: Amazon runs its offers on after it ("… Limited Period Festive Offer.").
    const d = t.replace(/^FREE delivery\s*/i, "Free ").split(/\.\s|\s+(?:Details|Limited|Order within|On orders)\b/)[0].replace(/\.$/, "");
    return d.slice(0, 80);
  });
  take("stock", () => textOf(["#availability", "#availabilityInsideBuyBox_feature_div", "#outOfStock"]).replace(/\.\s*$/, "").slice(0, 60));

  // The gallery of the colour on screen (500 px), including the photos behind "+N".
  take("photos", () => {
    const id = (u: string) => ((u || "").split("/I/")[1] || "").split(".")[0];
    const land: any = document.querySelector("#landingImage, #imgBlkFront, #main-image");
    let main = "";
    if (land) { try { main = land.src || Object.keys(JSON.parse(land.getAttribute("data-a-dynamic-image") || "{}"))[0] || ""; } catch (e) { main = land.src || ""; } }
    let list: any[] = [];
    for (const t of scripts) {
      const at = t.indexOf("'colorImages'");
      if (at < 0) continue;
      const a = t.indexOf("parseJSON('", at);
      if (a < 0) continue;
      const b = t.indexOf("')", a + 11);
      try { list = JSON.parse(t.slice(a + 11, b).split("\\'").join("'")); } catch (e) {}
    }
    const current = !main || list.some((p) => id(p.hiRes) === id(main) || id(p.large) === id(main) || id(p.main && Object.keys(p.main)[0]) === id(main));
    const photos = current ? list.map((p) => p.large || p.hiRes).filter(Boolean) : [];
    return (photos.length ? photos : main ? [main] : []).slice(0, 4);
  });

  // Colours, sizes and one variant per colour and size Amazon sells, from the twister's data.
  try {
    const dims: string[] = grab("dimensions") || [];
    const vv = grab("variationValues") || {};
    const map = grab("dimensionToAsinMap") || {};
    const cd = dims.find((d) => /color|colour|style|pattern/.test(d));
    const sd = dims.find((d) => /size/.test(d));
    if (dims.length && (cd || sd) && dims.every((d) => d === cd || d === sd) && Object.keys(map).length) {
      const sel = grab("selectedVariationValues") || {};
      const colours: any[] = cd ? vv[cd] || [] : [null];
      const sizes: any[] = sd ? vv[sd] || [] : [null];
      const curC = cd ? colours[sel[cd]] : null;
      const curS = sd ? sizes[sel[sd]] : null;
      // Sold out: known for the colour on screen only (its size row's states).
      const sorted = grab("sortedDimValuesForAllDims") || {};
      const off: any = {};
      for (const v of (sd && sorted[sd]) || []) if (v.dimensionValueState && v.dimensionValueState !== "AVAILABLE" && v.dimensionValueState !== "SELECTED") off[v.dimensionValueDisplayText] = true;
      const swatchPrice: any = {};
      for (const li of Array.from(document.querySelectorAll("li.inline-twister-swatch, li[data-asin], li[data-defaultasin]"))) {
        const name = clean(li.getAttribute("title") || ((li.querySelector("img") as any) || {}).alt || "").replace(/^Click to select\s*/i, "");
        const p = money((li as any).innerText || li.textContent);
        if (name && p) swatchPrice[name] = p;
      }
      const ci = grab("colorImages") || {};
      let order = colours.map((_c, i) => i);
      if (curC != null) order = [colours.indexOf(curC)].concat(order.filter((i) => colours[i] !== curC));
      order = order.slice(0, Math.min(8, Math.max(1, Math.floor(48 / Math.max(1, Math.min(sizes.length, 10))))));
      const outColours: any[] = [], variants: any[] = [];
      for (const ix of order) {
        const c = colours[ix];
        if (cd) {
          const own = (ci[c] || []).map((p: any) => p.large || p.hiRes).filter(Boolean);
          const ps = c === curC && out.photos && out.photos.length ? out.photos : own;
          outColours.push({ name: c, photos: ps.slice(0, 4).map((u: string) => ({ image: u })) });
        }
        sizes.slice(0, 10).forEach((s, si) => {
          const asin = map[dims.map((d) => (d === cd ? ix : si)).join("_")];
          if (!asin) return;
          const v: any = { id: asin, available: !(c === curC && s && off[s]) };
          if (c != null) v.colour = c;
          if (s != null) v.size = s;
          if (c != null && swatchPrice[c]) v.price = swatchPrice[c];
          variants.push(v);
        });
      }
      if (variants.length) {
        if (cd) out.colours = outColours;
        if (sd) out.sizes = sizes.slice(0, 10);
        out.variants = variants;
        out.current = { colour: curC, size: curS };
        out.coloursAll = cd ? colours.length : 0;
        out.found.push("variants");
      } else out.missing.push("variants");
    }
  } catch (e) { out.missing.push("variants"); }

  out.captcha = /validateCaptcha|Enter the characters you see below/i.test(location.href + " " + (document.body ? document.body.innerText.slice(0, 2000) : ""));
  return JSON.stringify(out);
}

/** The page reader as an `evaluate` script: an expression that returns its JSON. */
export const readProductPageSource = `(${readProductPage.toString()})()`;

/** Search results, best first: organic results, then sponsored ones, each ASIN once. */
export function readSearchPage(): string {
  const organic: any[] = [], sponsored: any[] = [], seen: any = {};
  let cards = Array.from(document.querySelectorAll('div[data-component-type="s-search-result"][data-asin]'));
  if (!cards.length) cards = Array.from(document.querySelectorAll("div[data-asin]")).filter((el) => el.querySelector('a[href*="/dp/"]'));
  for (const el of cards) {
    const asin = (el.getAttribute("data-asin") || "").trim();
    if (!/^[A-Z0-9]{10}$/.test(asin) || seen[asin]) continue;
    seen[asin] = true;
    const text = ((el as any).innerText || el.textContent || "");
    const title = ((el.querySelector("h2") as any) || {}).innerText || "";
    const row = { asin, title: String(title).replace(/\s+/g, " ").trim().slice(0, 120) };
    (/\bSponsored\b/.test(text) || el.querySelector(".puis-sponsored-label-text, .s-sponsored-label-text") ? sponsored : organic).push(row);
  }
  const blocked = /validateCaptcha|Enter the characters you see below/i.test(location.href + " " + (document.body ? document.body.innerText.slice(0, 2000) : ""));
  return JSON.stringify({ results: organic.concat(sponsored), organic: organic.length, captcha: blocked, url: location.href });
}

export const readSearchPageSource = `(${readSearchPage.toString()})()`;
