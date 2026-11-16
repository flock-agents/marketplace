// The grocery skills' in-page scripts reach the page as written. A page script in a plain template
// string loses every single backslash before the page sees it: `/\/pd\/(\d+)/` arrives as
// `//pd/(d+)/`, a comment, and BigBasket's search-products failed every call with "evaluate:
// SyntaxError: Unexpected token 'const'". Each script is checked as the page gets it: it compiles,
// and a plain template keeps every backslash (written doubled) or is String.raw.
//
// Run: bun test tests/grocery.
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const skills = join(import.meta.dir, "../../skills");
const SHOPS = ["bigbasket", "zepto", "zomato-blinkit"];
/** A template literal, String.raw or plain, with its escapes. */
const TEMPLATE = /(String\.raw)?`((?:[^`\\]|\\[\s\S])*)`/g;
/** A page script is an arrow function the page calls at once: `(() => {…})()` or `(async () => {…})()`. */
const PAGE_SCRIPT = /^\s*\((async\s*)?\(\)\s*=>/;

interface PageScript { where: string; raw: boolean; body: string }

function pageScripts(skill: string): PageScript[] {
  const dir = join(skills, skill, "scripts");
  return readdirSync(dir).filter((f) => f.endsWith(".ts")).flatMap((file) => {
    const src = readFileSync(join(dir, file), "utf8");
    return [...src.matchAll(TEMPLATE)]
      .filter(([, , body]) => PAGE_SCRIPT.test(body))
      .map(([, raw, body]) => ({ where: `${skill}/scripts/${file}`, raw: !!raw, body }));
  });
}

/** The text the page receives, with each `${…}` filled by a number. */
function asThePageGetsIt({ raw, body }: PageScript): { sent: string; written: string } {
  const filled = body.replace(/\$\{[^{}]*\}/g, "0");
  if (raw) return { sent: filled, written: filled };
  return { sent: new Function(`return \`${filled}\`;`)(), written: filled.replace(/\\\\/g, "\\") };
}

describe("the in-page scripts", () => {
  const scripts = SHOPS.flatMap(pageScripts);

  it("are found in every grocery skill", () => {
    for (const skill of SHOPS) expect(scripts.some((s) => s.where.startsWith(`${skill}/`))).toBe(true);
    expect(scripts.some((s) => s.where === "bigbasket/scripts/_bigbasket.ts")).toBe(true);
  });

  it("keep every backslash on the way to the page", () => {
    const lost = scripts.filter((s) => {
      const { sent, written } = asThePageGetsIt(s);
      return sent !== written;
    });
    expect(lost.map((s) => s.where)).toEqual([]);
  });

  it("compile as the page gets them", () => {
    const broken = scripts.flatMap((s) => {
      try {
        new Function(`return ${asThePageGetsIt(s).sent}`);
        return [];
      } catch (e) {
        return [`${s.where}: ${e}`];
      }
    });
    expect(broken).toEqual([]);
  });

  it("BigBasket's search reads the product id with its regex intact", () => {
    const search = scripts.find((s) => s.where === "bigbasket/scripts/_bigbasket.ts")!;
    expect(asThePageGetsIt(search).sent).toContain(String.raw`href.match(/\/pd\/(\d+)/)`);
  });

  it("catch a plain template that drops a backslash", () => {
    const old: PageScript = { where: "old", raw: false, body: String.raw`(() => { const id = (href.match(/\/pd\/(\d+)/) || [])[1]; const n = 1; })()` };
    const { sent, written } = asThePageGetsIt(old);
    expect(sent).not.toBe(written);
    expect(() => new Function(`return ${sent}`)).toThrow();
  });
});
