// NO PLACEHOLDERS IN A DRAFT (owner decision, 2026-09-10). A live Haiku draft
// read "Thanks for checking in. [AGGY STATUS UPDATE] As for Instinct, [YES/NO ON
// INSTINCT INTEREST]". The prompt at the time told the model to leave a bracket
// for a value it could not find; the owner ruled there are to be none: a draft
// is either sendable prose or it is not written. The prompt now says so, and
// this check is the deterministic backstop the executor runs before any
// browser write, so a model that brackets anyway gets a refusal it can act on
// (rewrite in plain prose, or drop the line) rather than a saved template.

/** The first bracketed placeholder in `body`, or null when there is none. */
export function findPlaceholder(body: unknown): string | null {
  if (typeof body !== "string" || !body) return null;
  // Square or curly brackets around a short run of text on one line: [GSTIN],
  // [YES/NO ON INSTINCT INTEREST], {name}, [insert date]. A closing bracket on
  // the same line is what makes it a blank rather than prose.
  const m = body.match(/[\[{][^\[\]{}\n]{1,80}[\]}]/);
  return m ? m[0] : null;
}

// NO DASHES IN A DRAFT (owner, 2026-09-23). The user's voice has none, and the
// seeded voice rule says so (wiki-db.ts DEFAULT_VOICE_ENTRIES). But that rule
// only reached the drafting routine: a draft asked for in chat got the session
// brief's top five voice rows by observation count, and a seed at count 1 never
// makes the cut once the crawl has learned a mailbox. Drafts written in chat
// came back full of em dashes. This check refuses them at the one place every
// draft write passes through, whoever asked for the draft.

/** The rule, stated once, for the refusal and for getVoice to hand out. */
export const NO_DASHES_RULE =
  "No em dashes (—), en dashes (–) or double hyphens (--) anywhere in a draft. Use a comma, a period, or parentheses instead. Plain hyphens inside words (follow-up) are fine.";

/**
 * The first dash in `body`, with a word either side so the model can find it,
 * or null when there is none. A line that is only "--" (an email signature
 * delimiter) is not prose and is allowed.
 */
export function findDash(body: unknown): string | null {
  if (typeof body !== "string" || !body) return null;
  for (const line of body.split(/\r?\n/)) {
    if (line.trim() === "--") continue;
    // A Markdown table's divider row (|---|:---:|) is table markup, turned into
    // a real table by the gmail skill (_bodyHtml.ts), not a dash in the prose.
    if (line.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)) continue;
    const m = line.match(/\S*\s*(?:[‒–—―]|--)\s*\S*/);
    if (m) return m[0].trim();
  }
  return null;
}

/** The placeholder rule above, stated for getVoice to hand out. */
export const NO_PLACEHOLDERS_RULE =
  "No placeholders: never leave a bracketed blank like [date] or {name}. A draft is sendable as written; leave out what you do not know.";

/** The hard rules every draft is held to, enforced by the executor. */
export const DRAFT_RULES: readonly string[] = [NO_DASHES_RULE, NO_PLACEHOLDERS_RULE];

// HOW TO WRITE IN THE VOICE (owner, 2026-09-23). Handed only the voice block, a
// live Haiku rewrite kept "Dear Ms. Chowdhury", "We are pleased to confirm" and
// capitalised section headings, and changed nothing but the sign-off. The block
// describes the user; these say what to DO with it, step by step, so a draft is
// rewritten in the voice rather than patched at the ends. Platform text, not
// learned data: nothing in it comes from mail.
export const VOICE_APPLY_STEPS: readonly string[] = [
  "Rewrite the whole draft in this voice; do not patch the old text.",
  "Open with the greeting pattern above, using the recipient's first name, even in a formal email.",
  "Close with the sign-off above, exactly as shown.",
  "Write the way the phrasing lines above write: plain sentences, the user's own words for asking, confirming and closing, no stock phrases like \"We are pleased to\".",
  "No headings, no capitalised labels, no bold. When the email asks for several facts, give them as short plain lines (\"Designation: Co-Founder\") under one sentence that introduces them, or as a Markdown table when the user asks for a table.",
];

// A RECIPIENT IS AN ADDRESS (owner, 2026-09-23). Live, an agent created a new
// draft with to: "shubham" and it went through: nothing checked that a
// recipient was an email address, and the agent had not looked one up.
const ADDRESS = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/**
 * The first entry in a comma- or semicolon-separated recipient field that is
 * not an email address ("a@b.com" or "Name <a@b.com>"), or null. An empty
 * field is fine: Cc and Bcc are optional.
 */
export function findBadRecipient(field: unknown): string | null {
  if (typeof field !== "string" || !field.trim()) return null;
  for (const raw of field.split(/[,;]/)) {
    const entry = raw.trim();
    if (!entry) continue;
    const angled = entry.match(/<([^<>]+)>\s*$/);
    if (!ADDRESS.test((angled ? angled[1] : entry).trim())) return entry;
  }
  return null;
}
