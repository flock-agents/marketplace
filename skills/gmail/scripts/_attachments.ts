// A thread's attachments as files (owner 2026-10-11, KITS: the Tranche 1 submission's deck and
// sheet were attachments, and nothing could open them). Pure module: the in-page expression only
// COLLECTS links; which ones are attachments, and their names, is decided here (unit-tested).
//
// Gmail serves an attachment at `…/mail/u/N/?ui=2&ik=…&view=att&th=…&attid=0.1&disp=…`. The print
// view lists each one with its name in bold and View / Download links; the conversation view also
// carries `download_url="<mime>:<name>:<url>"` on the attachment tile. `disp=attd` asks for the
// file as a download (disp=safe or inline would open Gmail's viewer instead).

export interface AttachmentLink { href: string; name: string }
export interface Attachment { name: string; url: string; key: string }

export const ATTACHMENT_LINKS_EXPR = `(() => {
  const txt = (el) => (el ? (el.innerText || el.textContent || '').trim() : '');
  const out = [];
  document.querySelectorAll('a[href*="view=att"]').forEach((a) => {
    const cell = a.closest('td');
    const bold = cell ? cell.querySelector('b') : null;
    out.push({ href: a.href, name: txt(bold) || txt(a) || a.getAttribute('aria-label') || '' });
  });
  document.querySelectorAll('[download_url]').forEach((el) => {
    const v = el.getAttribute('download_url') || '';
    const at = v.indexOf(':https://');
    const first = v.indexOf(':');
    if (at > first && first >= 0) out.push({ href: v.slice(at + 1), name: v.slice(first + 1, at) });
  });
  return JSON.stringify(out);
})()`;

/** Link words that are not a file's name. */
const GENERIC = /^(view|download|open|preview|scan|save to drive|add to drive|\d+\s*[kmg]?b)?$/i;

/** The attachments among a page's links: Gmail attachment URLs only (mail.google.com, view=att,
 *  an attid), one per message + attid, each a download URL (disp=attd) with its best name. */
export function attachmentsFromLinks(links: AttachmentLink[]): Attachment[] {
  const byKey = new Map<string, Attachment>();
  for (const l of links || []) {
    let u: URL;
    try { u = new URL(String(l?.href ?? "")); } catch { continue; }
    if (u.protocol !== "https:" || u.hostname !== "mail.google.com" || u.searchParams.get("view") !== "att") continue;
    const attid = u.searchParams.get("attid") || u.searchParams.get("realattid");
    if (!attid) continue;
    const msg = u.searchParams.get("permmsgid") || u.searchParams.get("th") || "";
    const key = `${msg}|${attid}`;
    u.searchParams.set("disp", "attd");
    const name = String(l?.name ?? "").replace(/\s+/g, " ").trim();
    const prev = byKey.get(key);
    const good = name && !GENERIC.test(name) ? name : "";
    if (!prev) byKey.set(key, { name: good, url: u.toString(), key });
    else if (good.length > prev.name.length) prev.name = good;
  }
  return [...byKey.values()].map((a, i) => ({ ...a, name: a.name || `attachment-${i + 1}` }));
}

/** Which attachments a call asks for: by name (case-insensitive, a part of the name is enough),
 *  else by 1-based index, else all of them. */
export function pickAttachments(all: Attachment[], opts: { name?: unknown; index?: unknown }): Attachment[] {
  const name = typeof opts.name === "string" ? opts.name.trim().toLowerCase() : "";
  if (name) {
    const exact = all.filter((a) => a.name.toLowerCase() === name);
    return exact.length ? exact : all.filter((a) => a.name.toLowerCase().includes(name));
  }
  const i = Number(opts.index);
  if (Number.isInteger(i) && i >= 1) return all[i - 1] ? [all[i - 1]] : [];
  return all;
}
