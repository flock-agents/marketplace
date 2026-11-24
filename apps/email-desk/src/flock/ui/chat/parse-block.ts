// Reads a block's JSON, repairing the one slip agents make at its end: a closing bracket too many or too few (live
// eval 2026-10-21: a correct Questions closed with `]}}`, so the whole block was shown as text). The frame, the server
// and the chat page all read a block through this (the chat page through a mirror, frontend/src/lib/chat/parse-block.ts,
// pinned by a test), so all three see the same block and give it the same ids. Pure, no imports.

/** At most this many brackets are added or removed: a bigger gap is not a slip. */
const MAX_FIX = 3;
const CLOSE: Record<string, string> = { "{": "}", "[": "]" };

export type ParsedBlock = { ok: true; value: unknown; repaired?: string } | { ok: false; error: string };

/** Where the brackets stand at the end of `s` (strings skipped): the ones still open, and the index of the first
 *  closer that had nothing to close (-1 when none). */
function scan(s: string): { open: string[]; surplusAt: number; inString: boolean } {
  const open: string[] = [];
  let inString = false, escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") open.push(c);
    else if (c === "}" || c === "]") {
      if (!open.length || CLOSE[open[open.length - 1]] !== c) return { open, surplusAt: i, inString };
      open.pop();
    }
  }
  return { open, surplusAt: -1, inString };
}

/** The block's JSON, or why it is not JSON. `repaired` says what was changed to read it. */
export function parseBlock(raw: string): ParsedBlock {
  try { return { ok: true, value: JSON.parse(raw) }; } catch (e) {
    const error = (e as Error).message;
    const text = raw.trimEnd();
    const { open, surplusAt, inString } = scan(text);
    if (inString) return { ok: false, error };
    let fixed: string | null = null, repaired = "";
    if (surplusAt >= 0) {
      // closers left over at the very end: drop them
      const tail = text.slice(surplusAt);
      const extra = tail.replace(/\s/g, "");
      if (/^[\]}]+$/.test(extra) && extra.length <= MAX_FIX && !open.length) {
        fixed = text.slice(0, surplusAt);
        repaired = `${extra.length} closing bracket${extra.length > 1 ? "s" : ""} too many at the end, left out`;
      }
    } else if (open.length && open.length <= MAX_FIX) {
      // closers missing at the end: add them
      fixed = text + open.map((o) => CLOSE[o]).reverse().join("");
      repaired = `${open.length} closing bracket${open.length > 1 ? "s" : ""} missing at the end, added`;
    }
    if (fixed === null) return { ok: false, error };
    try { return { ok: true, value: JSON.parse(fixed), repaired: `the JSON had ${repaired}; close every { and [ once` }; } catch { return { ok: false, error }; }
  }
}
