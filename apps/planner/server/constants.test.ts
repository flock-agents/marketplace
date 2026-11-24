// The closed lists and the app aliases the rest of revision 2 reads.
import { describe, it, expect } from "bun:test";
import { appOf, APP_NAMES, CART_SYNC, SHOP_APPS } from "./db/constants";

describe("appOf", () => {
  it("reads an app however it is written, and is null for anything else", () => {
    for (const [said, id] of [["Zepto", "zepto"], ["zepto-mcp", "zepto"], ["Swiggy", "swiggy-instamart"], ["Instamart", "swiggy-instamart"], ["swiggy instamart", "swiggy-instamart"],
      ["swiggy-instamart-mcp", "swiggy-instamart"], ["Blinkit", "zomato-blinkit"], ["Zomato Blinkit", "zomato-blinkit"], ["big basket", "bigbasket"], [" BigBasket ", "bigbasket"],
      ["Amazon", "amazon"], ["amazon fresh", "amazon"], ["amazon-fresh", "amazon"]]) expect(appOf(said), said).toBe(id as any);
    for (const bad of ["dmart", "", 7, null, undefined]) expect(appOf(bad), String(bad)).toBeNull();
  });

  it("every app has a name, and only Amazon has no cart to copy", () => {
    for (const a of SHOP_APPS) expect(APP_NAMES[a]).toBeString();
    expect(APP_NAMES.amazon).toBe("Amazon Fresh");
    expect(SHOP_APPS.filter((a) => !CART_SYNC[a])).toEqual(["amazon"]);
  });
});
