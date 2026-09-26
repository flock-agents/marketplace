// Shared, PURE draft-body -> compose-HTML conversion. No browser, no side
// effects, and no script entrypoint -- safe to import from another skill
// script (see _draftBody.ts for why that matters).
//
// REAL TABLES (owner, 2026-09-23). Drafts used to be typed as plain text, so an
// agent asked for "a neat table" could not make one: a Markdown table arrived
// as pipes and dashes, and a padded text table did not line up in Gmail's
// proportional font. A Markdown pipe table in a body now becomes a real
// <table> with inline styles (Gmail keeps inline styles and strips <style>).
// Every line outside a table is written exactly as before: one <div> per line,
// a blank line as <div><br></div>, which is Gmail's own compose markup.

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A cell may carry **bold**, as the agent writes it in chat. Escaped first, so
// the only markup in a cell is the <b> this adds.
function cellHtml(text: string): string {
  return escapeHtml(text.trim()).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
// The divider under a header row: |---|:---:|---: with optional outer pipes.
const isDivider = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
}

const TABLE_STYLE = "border-collapse:collapse;border:1px solid #d0d0d0;margin:4px 0";
const CELL_STYLE = "border:1px solid #d0d0d0;padding:4px 10px;text-align:left;vertical-align:top";
const HEAD_STYLE = `${CELL_STYLE};background:#f3f3f3`;

// A header row whose cells are all empty (| | |) is dropped. Markdown needs a
// header row to make a table at all, and for a list of labels and values there
// is no natural one: live, the model filled it with "Field | Value", which the
// owner called the only bad part of the table.
function tableHtml(rows: string[]): string {
  const [head, , ...body] = rows;
  const headCells = splitRow(head);
  const th = headCells.every((c) => !c.trim())
    ? ""
    : `<tr>${headCells.map((c) => `<th style="${HEAD_STYLE}">${cellHtml(c)}</th>`).join("")}</tr>`;
  const trs = body.map((r) => `<tr>${splitRow(r).map((c) => `<td style="${CELL_STYLE}">${cellHtml(c)}</td>`).join("")}</tr>`).join("");
  return `<table style="${TABLE_STYLE}"><tbody>${th}${trs}</tbody></table>`;
}

type Block = { kind: "line"; text: string } | { kind: "table"; rows: string[] };

function blocks(body: string): Block[] {
  const lines = (body || "").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    // A table is a header row, a divider row, and any rows under it.
    if (isTableRow(lines[i]) && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const rows = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) rows.push(lines[i++]);
      out.push({ kind: "table", rows });
      continue;
    }
    out.push({ kind: "line", text: lines[i++] });
  }
  return out;
}

/** True when the body holds at least one Markdown pipe table. */
export function hasTable(body: string): boolean {
  return blocks(body).some((b) => b.kind === "table");
}

/** A draft body -> Gmail compose HTML; pipe tables become real tables. */
export function bodyToComposeHtml(body: string): string {
  return blocks(body)
    .map((b) => (b.kind === "table" ? tableHtml(b.rows) : `<div>${b.text ? escapeHtml(b.text) : "<br>"}</div>`))
    .join("");
}


/**
 * The in-page script that writes `html` into the open compose, keeping any
 * quoted original Gmail put there -- the same splice-and-write updateDraft has
 * always used (set innerHTML, then fire `input` so Gmail autosaves). Used by
 * the create scripts only for a body with a table: typing stays the path for
 * everything else, so a plain draft is written exactly as before.
 */
export function writeComposeHtmlScript(html: string): string {
  return `(() => {
    const all = document.querySelectorAll('div[aria-label*="Message"][contenteditable="true"]');
    const compose = all[all.length - 1];
    if (!compose) return JSON.stringify({ ok: false, message: "Compose area not found." });
    const current = compose.innerHTML;
    const q = current.search(/<(blockquote|div)[^>]*class="[^"]*gmail_quote/i);
    compose.innerHTML = ${JSON.stringify(html)} + (q === -1 ? "" : current.slice(q));
    compose.dispatchEvent(new Event('input', { bubbles: true }));
    compose.dispatchEvent(new Event('keyup', { bubbles: true }));
    return JSON.stringify({ ok: true });
  })()`;
}
