// The eval's own food vocabulary and the contains scorer on hand-made reads.
import { describe, expect, test } from "bun:test";
import { canonTag, hasItem, itemCovers, tagsOfName } from "./vocab";
import { CONTAINS_LABELS, scoreContains } from "./contains-labels";

describe("vocab", () => {
  test("tags by name, broad tags included, undone by a word in front", () => {
    expect([...tagsOfName("Chicken curry")]).toEqual(expect.arrayContaining(["chicken", "meat"]));
    expect(tagsOfName("Kosha mangsho").has("red_meat")).toBe(true);
    expect(tagsOfName("Millet rice").has("white_rice")).toBe(false);
    expect(tagsOfName("Millet rice").has("millet")).toBe(true);
    expect(tagsOfName("Ragi dosa").has("white_rice")).toBe(false);
    expect(tagsOfName("Masala dosa").has("white_rice")).toBe(true);
    expect(tagsOfName("Eggless cake").has("egg")).toBe(false);
    expect(tagsOfName("Bhindi").size).toBe(0);
  });
  test("a rule item covers itself and narrower tags; spellings agree", () => {
    expect(canonTag("@nuts")).toBe("nuts");
    expect(canonTag("Eggs")).toBe("egg");
    expect(canonTag("garlic")).toBe("onion_garlic");
    expect(itemCovers("meat", "chicken")).toBe(true);
    expect(itemCovers("chicken", "meat")).toBe(false);
    expect(itemCovers("nuts", "peanut")).toBe(true);
    expect(hasItem(tagsOfName("Peanut chikki"), "nuts")).toBe(true);
    expect(hasItem(tagsOfName("Fish fry"), "meat")).toBe(false);
  });
});

describe("scoreContains", () => {
  const perfect = Object.fromEntries(CONTAINS_LABELS.map((l) => [l.dish, Object.fromEntries(["egg", "meat", "fish", "onion_garlic", "nuts", "peanut", "sugar", "white_rice", "dairy", "root_veg", "millet", "mushroom"].map((t) => [t, l.yes.includes(t as any)]))]));
  test("the labels themselves: 40 dishes, 100%", () => {
    expect(CONTAINS_LABELS.length).toBe(40);
    const s = scoreContains(perfect);
    for (const [k, [p, n]] of Object.entries(s.rates)) expect(`${k} ${p}`).toBe(`${k} ${n}`);
  });
  test("a missed yes lowers recall; a tag left out counts as unread, not wrong", () => {
    const got = JSON.parse(JSON.stringify(perfect));
    got["Chicken curry"].meat = false;
    delete got["Lemon rice"].peanut;
    const s = scoreContains(got);
    expect(s.rates.recall[0]).toBe(s.rates.recall[1] - 1);
    expect(s.rates.read[0]).toBe(s.rates.read[1] - 1);
    expect(s.perTag.meat.fn).toBe(1);
    expect(s.notes).toContain("Chicken curry: meat missed");
  });
  test("a dish the read skipped is all unread", () => {
    const got = { ...perfect };
    delete got["Idli"];
    expect(scoreContains(got).perTag.white_rice.unread).toBe(1);
  });
});
