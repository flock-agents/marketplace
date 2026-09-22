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
