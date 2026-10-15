// Shared, PURE draft-body helpers. No browser, no side effects, and no script
// entrypoint — safe to import from another skill script.
//
// Same reason _draftRows.ts exists: importing getDraft.ts to reuse
// extractDraftBody would run getDraft's own runScript(), because that module
// body executes whenever SKILL_PARAMS is set, which is true inside every
// spawned skill process. A helper import would therefore perform a real
// navigation as a side effect.
//
// WHY THIS IS SHARED AT ALL (I2): the owner-edit compare is a three-way
// comparison against "the text we last wrote", and it only works if both sides
// of that comparison went through the SAME transformation. Storing the plain
// text we sent and comparing it against extractDraftBody(innerHTML) does not:
// a blank line goes out as `<div><br></div>` and comes back as TWO newlines,
// one from the <br> and one from the </div>, so every multi-paragraph body
// compared as "owner-edited" on a draft nobody had touched. The compare failed
// closed, so nothing was destroyed — but updateDraft refused every real edit,
// and the whole mechanism was inert.
//
// The fix is to store what Gmail ACTUALLY HOLDS, not what we sent: a writer
// scrapes the compose region through this same extractor before it closes, and
// the caller records that. Every later compare is then read-vs-read through one
// transformation, so it is exact — no normalisation, no tolerance, and "the
// owner always wins" stays strict. That strictness matters more now than it
// did: the compare authorises DISCARDING a draft, so a false "untouched"
// destroys writing rather than merely overwriting it.

/**
 * Extract the owner-authored portion of a draft's compose body from its
 * innerHTML, stripping Gmail's quoted original content (wrapped in
 * `blockquote.gmail_quote` when replying inline) so a caller comparing "what
 * was written" never sees it polluted by the quoted thread history. Block
 * boundaries (`<div>`, `<br>`) become newlines; everything else is stripped
 * to plain text. Never throws — empty input yields an empty string.
 */
export function extractDraftBody(bodyHtml: string): string {
  const html = bodyHtml || "";
  const quoteIdx = html.search(/<blockquote[^>]*class="[^"]*gmail_quote[^"]*"/i);
  const composedHtml = quoteIdx === -1 ? html : html.slice(0, quoteIdx);

  return composedHtml
    // A table (see _bodyHtml.ts) reads back as one "| a | b |" line per row,
    // not as its cells' text run together.
    .replace(/<tr[^>]*>\s*<t[dh][^>]*>/gi, "\n| ")
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, " | ")
    .replace(/<\/t[dh]>\s*<\/tr>/gi, " |\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<div[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/**
 * The in-page scrape that reads a compose region's innerHTML. Used by every
 * writer to capture what Gmail actually saved, and by getDraft to read a draft
 * back later — the same selectors on both sides, so the two cannot drift.
 *
 * Returns the raw innerHTML; run it through extractDraftBody in TypeScript
 * rather than in the page, so the transformation stays unit-testable.
 */
export const COMPOSE_BODY_SCRAPE = `(() => {
  const compose = document.querySelector('div[aria-label="Message Body"][contenteditable="true"]') ||
                  document.querySelector('.Am.Al.editable') ||
                  document.querySelector('[role="textbox"][aria-label*="Message"]');
  return compose ? compose.innerHTML : '';
})()`;

/**
 * A received message's HTML -> readable plain text (Task 27). The thread scrape
 * used `textContent`, which drops every line break: a reply arrived as one
 * run-on paragraph ("Hey Shiva,There have been…?- PlutoOn Fri … wrote:Hi…").
 *
 * `<br>` is a newline. A block element (div, p, li, tr, td, blockquote, h1-h6,
 * …) starts a new line, and a run of block boundaries is ONE boundary, so
 * Gmail's own `<div>line</div><div>line</div>` markup reads as consecutive
 * lines and `<div><br></div>` as one blank line. Source whitespace collapses as
 * a browser would. List items read "- item". Each line is trimmed, and blank
 * lines collapse to at most one.
 *
 * Why not extractDraftBody: that one is FROZEN. Its exact output is stored as
 * "what Gmail holds" and later compared read-vs-read to detect an owner edit
 * (see the top of this file), so changing how it treats a single tag would
 * mark every draft written before the change as owner-edited. This is the
 * converter for message text; extractDraftBody stays the draft compare's.
 *
 * SELF-CONTAINED ON PURPOSE: it runs IN THE PAGE too, inlined by source
 * (`${htmlToText.toString()}`, like _openDraft.ts's findDraftCompose), so it
 * may reference nothing outside its own body. Never throws.
 */
export function htmlToText(html: string): string {
  const B = "\u0001"; // a block boundary, resolved below
  let s = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/\s+/g, " ")
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, B + "- ")
    .replace(/<\/?(?:div|p|li|ul|ol|dl|dt|dd|table|thead|tbody|tfoot|tr|td|th|blockquote|h[1-6]|pre|hr|section|article|header|footer|center|address)\b[^>]*>/gi, B)
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;| /gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d) => { const n = Number(d); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; })
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => { const n = parseInt(h, 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; })
    .replace(/&amp;/gi, "&");
  // A boundary breaks the line unless the text is already at a line start, so
  // `a<br></div><div>b` stays two lines, not three.
  s = s.replace(/[ \t]*\u0001[ \t]*/g, B);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === B) { if (out && out[out.length - 1] !== "\n") out += "\n"; }
    else out += c;
  }
  return out
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
