// The person's voice, kept in their own copy (Task 2.9, spec §2.6): the `voice_profile` table, one row per (mailbox,
// dimension). Ported from Flock's wiki-ops.ts upsertVoiceEntry, voice-store.ts storeVoiceProfile / hasStoredVoice and
// wiki/voice-page.ts (the Voice tab's data and edits), keyed by account instead of address.
//
// Two writers only, and the row says which: the crawl ('voice-crawl') and the person on the settings page ('owner-edit').
// No agent writes here: Flock's provenance machinery against agent-posted rows (POST /api/wiki/voice) has nothing to guard
// in the app, because the app has no such route.
//
// WHAT THE PERSON SAID STAYS SAID. A row they edited or forgot is theirs: a re-learn upserts every dimension it learns and
// would otherwise replace their words. Only their own edit writes over it; Restore deletes it so the crawl may learn it again.
import type { Database } from "bun:sqlite";
import { getStore } from "../store";
import type { VoiceEntryWrite } from "./extract";

export const CRAWL_SOURCE = "voice-crawl";
export const OWNER_SOURCE = "owner-edit";

export interface VoiceRowRecord {
  accountId: string;
  dimension: string;
  value: string;
  examples: string[];
  observationCount: number;
  source: string;
  updatedAt: number;
}

const parseExamples = (s: unknown): string[] => {
  try {
    const v = JSON.parse(String(s ?? "[]"));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

/** Every row of one mailbox, by dimension. */
export function voiceRows(accountId: string, db: Database = getStore()): VoiceRowRecord[] {
  const rows = db.query(
    "SELECT account_id, dimension, value, examples, observation_count, source, updated_at FROM voice_profile WHERE account_id = ? ORDER BY dimension",
  ).all(accountId) as Array<{ account_id: string; dimension: string; value: string; examples: string; observation_count: number; source: string; updated_at: number }>;
  return rows.map((r) => ({
    accountId: r.account_id, dimension: r.dimension, value: r.value, examples: parseExamples(r.examples),
    observationCount: r.observation_count, source: r.source, updatedAt: r.updated_at,
  }));
}

/** The mailboxes that have any voice row. */
export function voiceAccounts(db: Database = getStore()): string[] {
  return (db.query("SELECT DISTINCT account_id FROM voice_profile ORDER BY account_id").all() as { account_id: string }[]).map((r) => r.account_id);
}

/**
 * Write one row. A row the person wrote is kept unless this write is theirs too. A crawl's examples REPLACE the row's: they
 * are this crawl's evidence, and merging with the last crawl's would show snippets the current claim never counted.
 * Answers whether the row now holds this write.
 */
export function upsertVoiceRow(
  input: { accountId: string; dimension: string; value: string; examples?: string[]; source: string; observationCount?: number },
  db: Database = getStore(),
): boolean {
  const existing = db.query("SELECT source FROM voice_profile WHERE account_id = ? AND dimension = ?")
    .get(input.accountId, input.dimension) as { source: string } | null;
  if (existing?.source === OWNER_SOURCE && input.source !== OWNER_SOURCE) return false;
  db.query(
    `INSERT INTO voice_profile (account_id, dimension, value, examples, observation_count, source, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(account_id, dimension) DO UPDATE SET value = excluded.value, examples = excluded.examples,
       observation_count = excluded.observation_count, source = excluded.source, updated_at = excluded.updated_at`,
  ).run(
    input.accountId, input.dimension, input.value, JSON.stringify((input.examples ?? []).slice(0, 10)),
    input.observationCount ?? 1, input.source, Date.now(),
  );
  return true;
}

/** A crawl's rows for one mailbox, `sampleCount` kept as each row's observation count ("counted across 7 of your sent
 *  emails"). Returns how many rows were written; the person's own rows are skipped, never counted. */
export function storeLearnedVoice(accountId: string, entries: VoiceEntryWrite[], sampleCount: number, db: Database = getStore()): number {
  if (!accountId) return 0;
  let stored = 0;
  db.transaction(() => {
    for (const e of entries) {
      if (upsertVoiceRow({ accountId, dimension: e.dimension, value: e.value, examples: e.examples ?? [], source: CRAWL_SOURCE, observationCount: sampleCount }, db)) stored++;
    }
  })();
  return stored;
}

/** Whether this mailbox has a voice the drafter can use: a learned or person-written row that says something. */
export function hasVoice(accountId: string, db: Database = getStore()): boolean {
  if (!accountId) return false;
  return !!db.query(
    "SELECT 1 FROM voice_profile WHERE account_id = ? AND source IN (?, ?) AND (value != '' OR examples != '[]') LIMIT 1",
  ).get(accountId, CRAWL_SOURCE, OWNER_SOURCE);
}

// ---- the settings page's data (Flock wiki/voice-page.ts) ------------------------------------------------------------------

export interface VoiceRow {
  /** What an edit writes back to. `part` splits the vocabulary row in two. */
  dimension: string;
  part?: "phrases" | "abbreviations";
  label: string;
  value: string;
  examples: string[];
  /** The person wrote this on the settings page; no re-learn overwrites it. */
  editedByYou?: boolean;
  /** "Counted across 7 of your sent emails", only when the crawl recorded a count. */
  basis?: string;
}
export interface VoiceGroup { title: string; rows: VoiceRow[] }
export interface VoicePageAccount { groups: VoiceGroup[]; notLearned: string[]; forgotten: Array<{ label: string; dimension: string }> }

/** Dimensions computed by counting, not read by a model: their basis is a count. */
const COUNTED = new Set(["avoidance_patterns", "sentence_length", "structure"]);

/** The page's own words, in reading order. Second person, because it is addressed to the person whose voice it is (the
 *  drafter's labels in block.ts are third person, addressed to a model). */
const LAYOUT: Array<{ title: string; dims: Array<[string, string]> }> = [
  { title: "Opening and closing", dims: [["greeting_style", "Greeting"], ["sign_off", "Sign-off"]] },
  {
    title: "Style",
    dims: [
      ["formality", "Register"], ["sentence_length", "Sentences"], ["avoidance_patterns", "Punctuation"],
      ["structure", "Capitalization"], ["cultural_markers", "Language"],
    ],
  },
  {
    title: "Phrases you reuse",
    dims: [
      ["phrasing_request", "Asking for something"], ["phrasing_acknowledge", "Acknowledging without committing"],
      ["phrasing_escalate", "Raising urgency or pushing back"], ["phrasing_closing", "Closing line"],
      ["vocabulary", "Phrases you often use"],
    ],
  },
];

export const EDITABLE_DIMENSIONS: ReadonlySet<string> = new Set(LAYOUT.flatMap((g) => g.dims.map(([d]) => d)));

const capFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const stripEnd = (s: string) => s.trim().replace(/\.$/, "");
const quoted = (value: string, re: RegExp) => re.exec(value)?.[1];

/** The stored values are written for the drafting model ('Opens with "Hi Keshav," (write the actual recipient's name).').
 *  Each is reduced to what it says about the person; anything unrecognised is shown as stored, capitalised. */
type Readable = { label?: string; part?: VoiceRow["part"]; value: string; examples: string[] };
function readable(dim: string, value: string, examples: string[]): Readable[] {
  switch (dim) {
    case "greeting_style":
      return [{ value: examples[0] ?? quoted(value, /Opens with "([^"]*)"/) ?? capFirst(value), examples: examples.slice(1) }];
    case "sign_off":
      return [{ value: examples[0] ?? quoted(value, /Signs off "([\s\S]*)"/) ?? capFirst(value), examples: examples.slice(1) }];
    case "avoidance_patterns":
      return [{ value: capFirst(value.replace(/^Punctuation:\s*/i, "")), examples }];
    case "formality":
      return [{ value: capFirst(value), examples }];
    case "cultural_markers":
      return [{ value: stripEnd(value.replace(/^Writes in\s+/i, "")), examples }];
    case "structure":
      return [{ value: capFirst(stripEnd(value.replace(/^Writes in\s+/i, ""))), examples }];
    case "vocabulary": {
      const out: Readable[] = [];
      if (examples.length) out.push({ part: "phrases", value: "", examples });
      const abbrev = quoted(value, /Abbreviations:\s*(.+)$/);
      if (abbrev) out.push({ label: "Abbreviations", part: "abbreviations", value: capFirst(stripEnd(abbrev)), examples: [] });
      return out;
    }
    default:
      return [{ value: capFirst(value.trim()), examples }];
  }
}

/** One mailbox's voice as the settings page shows it. */
export function voicePageFor(accountId: string, db: Database = getStore()): VoicePageAccount {
  const dims = new Map<string, VoiceRowRecord>();
  for (const r of voiceRows(accountId, db)) if (r.source === CRAWL_SOURCE || r.source === OWNER_SOURCE) dims.set(r.dimension, r);
  const notLearned: string[] = [];
  const forgotten: VoicePageAccount["forgotten"] = [];
  const groups: VoiceGroup[] = LAYOUT.map(({ title, dims: layout }) => {
    const out: VoiceRow[] = [];
    for (const [dim, label] of layout) {
      const learned = dims.get(dim);
      if (!learned) { notLearned.push(label); continue; }
      // An empty row of the person's is a Forget: listed, never shown as a value.
      if (!learned.value && learned.examples.length === 0) { forgotten.push({ label, dimension: dim }); continue; }
      for (const r of readable(dim, learned.value, learned.examples)) {
        if (!r.value && r.examples.length === 0) continue;
        const row: VoiceRow = { dimension: dim, label: r.label ?? label, value: r.value, examples: r.examples };
        if (r.part) row.part = r.part;
        if (learned.source === OWNER_SOURCE) row.editedByYou = true;
        // A count of 1 proves nothing: claim a basis only when there is one.
        else if (learned.observationCount > 1) {
          row.basis = `${COUNTED.has(dim) ? "Counted across" : "Read from"} ${learned.observationCount} of your sent emails`;
        }
        out.push(row);
      }
    }
    return { title, rows: out };
  }).filter((g) => g.rows.length > 0);
  return { groups, notLearned, forgotten };
}

// ---- the person's edits (Flock wiki/voice-page.ts editVoiceRow / forgetVoiceRow / restoreVoiceRow) ------------------------

/** An edit is written back in the drafter's phrasing, so block.ts reads the person's row exactly as it reads a learned one. */
function storedForm(accountId: string, dimension: string, value: string, part: VoiceRow["part"], db: Database): { value: string; examples: string[] } {
  const v = value.trim();
  switch (dimension) {
    case "greeting_style": return { value: `Opens with "${v}" (write the actual recipient's name).`, examples: [v] };
    case "sign_off": return { value: `Signs off "${v}".`, examples: [v] };
    case "avoidance_patterns": return { value: `Punctuation: ${v}`, examples: [] };
    case "cultural_markers":
    case "structure": return { value: `Writes in ${v}.`, examples: [] };
    case "vocabulary": {
      const prev = voiceRows(accountId, db).find((r) => r.dimension === "vocabulary");
      const prevAbbrev = quoted(prev?.value ?? "", /Abbreviations:\s*(.+)$/)?.replace(/\.$/, "");
      const phrases = part === "phrases"
        ? v.split(/\n+/).map((s) => s.trim().replace(/^["“]|["”]$/g, "")).filter(Boolean)
        : (prev?.examples ?? []);
      const abbrev = part === "abbreviations" ? v.replace(/\.$/, "") : prevAbbrev;
      return { value: `Reuses these phrases.${abbrev ? ` Abbreviations: ${abbrev}.` : ""}`, examples: phrases };
    }
    default: return { value: v, examples: [] };
  }
}

export function editVoiceRow(accountId: string, dimension: string, value: string, part?: VoiceRow["part"], db: Database = getStore()): boolean {
  const stored = storedForm(accountId, dimension, value, part, db);
  return upsertVoiceRow({ accountId, dimension, value: stored.value, examples: stored.examples, source: OWNER_SOURCE }, db);
}

/** Forget: an empty row of the person's. The drafter skips it (Flock's rule for the heading applies again); the crawl
 *  cannot write over it. */
export function forgetVoiceRow(accountId: string, dimension: string, db: Database = getStore()): boolean {
  return upsertVoiceRow({ accountId, dimension, value: "", examples: [], source: OWNER_SOURCE }, db);
}

/** Undo a Forget (or an edit): drop the person's row, so the next crawl learns it afresh. */
export function restoreVoiceRow(accountId: string, dimension: string, db: Database = getStore()): boolean {
  return db.query("DELETE FROM voice_profile WHERE account_id = ? AND dimension = ? AND source = ?")
    .run(accountId, dimension, OWNER_SOURCE).changes > 0;
}
