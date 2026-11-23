// Guards from slot-model spec §8, run with the planner suite (bun test server/):
//  (a) no eval household's person or family name in any model-facing text: the server's prompts and strings, its guides,
//      and the app manifests. An eval family in a prompt is tuning to the test.
//  (b) no new word lists in setup and plan code: a regex naming weekdays, kinship words or "less"/"more" inside
//      server/setup.ts, server/makePlan.ts (or a setup/ plan/ folder beside them) fails. Words like these live only in the
//      allowlisted constants files (server/quoteLint.ts, server/db/constants.ts), so meaning is read by the model, not by
//      code matching phrases ("Amma", "weekend") — spec principle, top of the spec.
// The day/count lint itself (spec §4.2) is tested in quoteLint.test.ts.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { ALL_HOUSEHOLDS } from "../evals/households";
import { nameHits, scan, show, wordListHits, type WordHit } from "../evals/lib/guards";

const APP = join(import.meta.dir, "..");
const SERVER = import.meta.dir;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
}

// ── (a) No eval household name in model-facing text ──

/** Every eval household's names: its people, its help, its owner, the family name from its id, and any
 *  named guest of its week. Common words are not names here. */
function householdNames(): string[] {
  const names = new Set<string>();
  for (const h of ALL_HOUSEHOLDS) {
    const add = (n: unknown) => { if (typeof n === "string" && n.trim()) names.add(n.trim()); };
    // Nicknames are left out: they are family words ("Amma", "Papaji"), not this family's names; guard (b) covers code that
    // matches them.
    for (const p of (h.household["household.people"] as any[]) ?? []) add(p.name);
    for (const x of (h.household["household.help"] as any[]) ?? []) add(x.name);
    add(h.owner);
    if (h.truth.cook) add(h.truth.cook.name);
    for (const e of h.truth.week ?? []) if (e.kind !== "guests") add(e.person);
    add(h.id.split("-")[1]);
  }
  return [...names].map((n) => n.replace(/^./, (c) => c.toUpperCase()));
}

/** The model-facing text of the planner: its manifests, every Markdown file under server/, and the strings, templates and
 *  regexes of server code (tests and the test kit excluded; comments are not sent to a model). */
function modelFacing(): { file: string; line: number; text: string }[] {
  const out: { file: string; line: number; text: string }[] = [];
  for (const f of ["flock.app.json", "flock.marketplace.json", "catalog.json", "settings.json"].map((x) => join(APP, x)).filter(existsSync))
    readFileSync(f, "utf8").split("\n").forEach((text, i) => out.push({ file: relative(APP, f), line: i + 1, text }));
  for (const f of walk(SERVER)) {
    if (/\.test\.ts$|testkit\.ts$/.test(f)) continue;
    if (f.endsWith(".md")) readFileSync(f, "utf8").split("\n").forEach((text, i) => out.push({ file: relative(APP, f), line: i + 1, text }));
    else if (f.endsWith(".ts")) for (const p of scan(readFileSync(f, "utf8"))) if (p.kind !== "comment") out.push({ file: relative(APP, f), line: p.line, text: p.text });
  }
  return out;
}

// ── (b) No new word lists in setup and plan code ──

/** The files the guard reads, and the allowlisted constants files (never read: their words are the allowed list). */
const SCANNED = (f: string) => /server\/(setup|makePlan)(\.ts|\/)|server\/(setup|plan)\//.test(f.replace(/\\/g, "/")) && f.endsWith(".ts") && !f.endsWith(".test.ts");
export const ALLOWLIST = ["server/quoteLint.ts", "server/db/constants.ts"];

/** The 2.x word lists still in server/setup.ts and server/makePlan.ts when this guard was written (23 Nov 2026), by file and
 *  regex text. Lanes B and C replace these files (spec §3, no adapters): delete each entry as its regex goes. Nothing is
 *  ever added here: a new word list belongs in an allowlisted constants file, or (better) in the model's reading. */
export const GRANDFATHERED: string[] = [];

describe("eval guards (spec §8)", () => {
  test("the scanner finds regex literals, strings and templates, and skips comments and division", () => {
    const src = [
      "// a comment with /Monday/ in it",
      "const a = /\\b(mon|tue)day\\b/i, b = x / 2 / y;",
      "const s = 'Amma said hi', t = `for ${name} on Sunday`;",
      "if (/less|more/.test(q)) return /papa/i;",
      "const r = new RegExp(\"weekend|weekday\", \"i\");",
    ].join("\n");
    const p = scan(src);
    expect(p.filter((x) => x.kind === "regex").map((x) => x.text)).toEqual(["\\b(mon|tue)day\\b", "less|more", "papa"]);
    expect(p.filter((x) => x.kind === "string").map((x) => x.text)).toContain("Amma said hi");
    expect(p.filter((x) => x.kind === "template").map((x) => x.text)).toEqual(["for ", " on Sunday"]);
    expect(wordListHits(src).map((h) => h.kind).sort()).toEqual(["kinship", "less_more", "weekday", "weekday"]);
    expect(wordListHits("const ok = /\\d+\\s*\\/\\s*week/i; const ok2 = /^[a-z_]+$/;")).toEqual([]);
  });

  test("the name check finds a household name in a string, not inside another word", () => {
    const hits = nameHits([{ file: "x.ts", line: 1, text: "e.g. Gowri Shankar's dinner" }, { file: "y.ts", line: 2, text: "Ramadan, Ramesh-free" }], ["Gowri Shankar", "Ram"]);
    expect(hits).toEqual(['x.ts:1: "Gowri Shankar" in "e.g. Gowri Shankar\'s dinner"']);
  });

  test("(a) no eval household's name in any model-facing text (prompts, guides, manifests)", () => {
    const names = householdNames();
    expect(names.length).toBeGreaterThan(40);
    expect(nameHits(modelFacing(), names)).toEqual([]);
  });

  test("(b) no word lists (weekdays, kinship words, less/more) in regexes of setup and plan code", () => {
    const files = walk(SERVER).filter((f) => SCANNED(f) && !ALLOWLIST.includes(relative(APP, f).replace(/\\/g, "/")));
    expect(files.length).toBeGreaterThan(0);
    const hits = files.flatMap((f) => wordListHits(readFileSync(f, "utf8"), relative(APP, f).replace(/\\/g, "/")));
    const key = (h: WordHit) => `${h.file}|${h.text}`;
    const gone = GRANDFATHERED.filter((g) => !hits.some((h) => key(h) === g));
    if (gone.length) console.warn(`evalGuards: ${gone.length} grandfathered word list(s) are gone; delete them from GRANDFATHERED:\n  ${gone.join("\n  ")}`);
    expect(hits.filter((h) => !GRANDFATHERED.includes(key(h))).map(show)).toEqual([]);
  });
});
