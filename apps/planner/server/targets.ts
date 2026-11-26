// A person's food goals (people.targets): more or less protein, carbs and fat than usual, and their own words in `note`.
// Stored as JSON; a row from before 4.2.0 held free text, which boot moves into this shape once (migrateTargets), the text
// kept as the note. The plan leans towards dishes that fit (fillWeek's choice, after every food rule), never past a rule.
// Pure but for the boot move: the Family page reads targetsText from here too.
import { TARGET_LEVELS, type TargetKey } from "./db/constants";
import type { Database } from "bun:sqlite";
import type { Nutrient } from "./kinds";

export type Targets = { protein?: "high" | "normal" | "low"; carbs?: "low" | "normal" | "high"; fat?: "low" | "normal" | "high"; note?: string };
const KEYS = Object.keys(TARGET_LEVELS) as TargetKey[];

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// ── Reading the family's words ──

/** The words for each nutrient, as a family says them. */
const WORDS: Record<TargetKey, string> = { protein: "protein", carbs: "carbs?|carbohydrates?|rice|sugar", fat: "fat|oil|ghee|fried|oily" };
const LESS = "low|less|lower|reduce|reduced|cut|cut down on|fewer|no|limit|limited|avoid";
const MORE = "high|more|extra|rich|lots of|plenty of|good";

/** The levels said in words ("high protein, less oil" → protein high, fat low); what is not said is left out. */
export function targetsFromText(text: string): Targets {
  const t = text.toLowerCase();
  const out: Targets = {};
  for (const k of KEYS) {
    const w = WORDS[k];
    const low = new RegExp(`\\b(${LESS})[\\s-]+(?:in\\s+)?(?:${w})\\b|\\b(?:${w})\\s*(?:free|light)\\b`).test(t);
    const high = new RegExp(`\\b(${MORE})[\\s-]+(?:in\\s+)?(?:${w})\\b|\\b(?:${w})[\\s-]*(?:rich|heavy)\\b`).test(t);
    if (low !== high) (out as Record<string, string>)[k] = low ? "low" : "high";
  }
  return out;
}

/** A level as sent, or a refusal's reason. */
function levelOf(k: TargetKey, v: unknown): string | { error: string } {
  const ok = TARGET_LEVELS[k] as readonly string[];
  return typeof v === "string" && ok.includes(v) ? v : { error: `targets.${k} must be one of: ${ok.join(", ")}` };
}

/** targets as set_person takes it: { protein?, carbs?, fat?, note? }, or the family's words (read into levels, kept as the
 *  note), or null to clear. A refusal's reason when a level is not one of the closed list. */
export function targetsInput(v: unknown): Targets | null | { error: string } {
  if (v === null) return null;
  if (typeof v === "string") { const note = v.trim(); return note ? { ...targetsFromText(note), note } : null; }
  if (!isObject(v)) return { error: "targets must be { protein?: high | normal | low, carbs?: low | normal | high, fat?: low | normal | high, note? }, or the family's words" };
  const extra = Object.keys(v).filter((k) => k !== "note" && !KEYS.includes(k as TargetKey));
  if (extra.length) return { error: `targets takes protein, carbs, fat and note only, not ${extra.join(", ")}` };
  const out: Targets = {};
  for (const k of KEYS) {
    if (v[k] == null) continue;
    const level = levelOf(k, v[k]);
    if (typeof level !== "string") return level;
    (out as Record<string, string>)[k] = level;
  }
  if (typeof v.note === "string" && v.note.trim()) out.note = v.note.trim();
  return Object.keys(out).length ? out : null;
}

/** A stored targets column read: JSON, or (a row from before the move) free text read into levels with the text as its note. */
export function targetsOf(stored: string | null | undefined): Targets | null {
  if (!stored?.trim()) return null;
  try {
    const v = JSON.parse(stored);
    if (isObject(v)) { const t = targetsInput(v); return t && !("error" in t) ? t : null; }
  } catch { /* free text, from before 4.2.0 */ }
  const t = targetsInput(stored);
  return t && !("error" in t) ? t : null;
}

/** The goals as a person reads them: their own words when kept, else the levels ("high protein, low carbs"). */
export function targetsText(t: Targets | null): string {
  if (!t) return "";
  if (t.note) return t.note;
  return KEYS.filter((k) => t[k] && t[k] !== "normal").map((k) => `${t[k]} ${k}`).join(", ");
}

// ── The plan's lean ──

/** How well a dish fits the goals of the people at a meal: +1 for each person whose goal it meets (high protein and it is
 *  rich in protein), -1 for each it goes against (low carbs and it is rich in carbs). 0 with no goals. */
export function targetScore(rich: Set<Nutrient>, goals: Targets[]): number {
  let score = 0;
  for (const g of goals) for (const k of KEYS) {
    const level = g[k];
    if (!level || level === "normal" || !rich.has(k)) continue;
    score += level === "high" ? 1 : -1;
  }
  return score;
}

// ── The move at boot (silent, logs only) ──

/** People rows whose targets are still free text get the JSON shape, the text kept as the note. Answers how many moved. */
export function migrateTargets(sqlite: Database): number {
  const rows = sqlite.query(`SELECT id, targets FROM people WHERE targets IS NOT NULL AND trim(targets) <> ''`).all() as { id: string; targets: string }[];
  let moved = 0;
  for (const r of rows) {
    if (isJsonObject(r.targets)) continue;
    const t = targetsOf(r.targets);
    sqlite.query(`UPDATE people SET targets = ? WHERE id = ?`).run(t ? JSON.stringify(t) : null, r.id);
    moved++;
  }
  if (moved) console.log(`[planner] targets: ${moved} people's goals moved to the structured shape`);
  return moved;
}
const isJsonObject = (s: string): boolean => { try { return isObject(JSON.parse(s)); } catch { return false; } };
