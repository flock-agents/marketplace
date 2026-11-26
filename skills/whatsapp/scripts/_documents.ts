/**
 * WhatsApp: the PDFs read-chat downloads (1.1.0; owner 2026-11-26: school groups post their notices
 * and circulars as PDFs).
 *
 * How: in the chat read-chat already has open (never another WhatsApp Web open), a real click on the
 * document's download button. WhatsApp Web fetches the file from its own media servers, as it does
 * for every photo it shows, and hands the browser the file; Flock keeps what the page downloads in
 * the agent's own downloads folder (`<workspace>/downloads/`, the folder Gmail's and Drive's
 * downloads land in) and reports it as `{fileName, path, size}`.
 *
 * Limits: PDFs only; at most 5 downloads a read, newest first; nothing over 10 MB (by the size
 * WhatsApp shows, before any click, and by the file kept, deleted when over); each download waits at
 * most 20 s, and none starts when the read is close to its own timeout or to today's WhatsApp time.
 * A PDF downloaded before (same message, file still there at the same size) is given again, not
 * fetched again: remembered in documents.json in the skill's data folder. Every other document, and
 * any PDF not downloaded, stays a placeholder with a short reason.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import type { DocInfo, Message } from "./_page";

export const DOC_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  perRead: 5,
  waitMs: 20_000,
} as const;

/** A document as read-chat answers it: the file to read, or why there is none. */
export type DocResult = { name: string; path: string; size: number } | { name: string; error: string };

/** What a Flock download step reports for one file. */
export interface Kept { fileName?: string; path?: string; size?: number; error?: string }

const UNITS: Record<string, number> = { b: 1, byte: 1, bytes: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };

/** The bytes a size WhatsApp shows stands for ("245 kB", "1,5 MB"), or null when it shows none. */
export function bytesOf(size: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(bytes|byte|b|kb|mb|gb)(?![a-z])/i.exec(size || "");
  if (!m) return null;
  return Math.round(parseFloat(m[1].replace(",", ".")) * UNITS[m[2].toLowerCase()]);
}

const mb = (bytes: number) => `${Math.round((bytes / 1024 ** 2) * 10) / 10} MB`;
const MAX_MB = `${DOC_LIMITS.maxBytes / 1024 ** 2} MB`;

/** Whether a file Flock kept is the document asked for: its name, made safe and maybe numbered "(1)". */
export function sameFile(fileName: string, docName: string): boolean {
  if (!docName) return true;
  const key = (s: string) => s.normalize("NFKC").replace(/[\u0000-\u001f\u007f<>:"|?*\\/]/g, "_").replace(/ \(\d+\)(?=\.[^.]*$|$)/, "").trim().toLowerCase();
  return key(fileName) === key(docName);
}

function removeFile(path: string | undefined): void {
  if (path) try { unlinkSync(path); } catch { /* already gone */ }
}

/** Whether `path` starts as a PDF does. */
function isPdf(path: string): boolean {
  try {
    const fd = openSync(path, "r");
    try {
      const head = Buffer.alloc(5);
      readSync(fd, head, 0, 5, 0);
      return head.toString("latin1") === "%PDF-";
    } finally { closeSync(fd); }
  } catch { return false; }
}

/** A file Flock kept, checked: a PDF of at most 10 MB stays, anything else is deleted with why. */
export function checkKept(kept: Kept, name: string): DocResult {
  if (!kept.path) return { name, error: `not downloaded: ${(kept.error || "the download failed").slice(0, 160)}` };
  const size = typeof kept.size === "number" ? kept.size : (() => { try { return statSync(kept.path!).size; } catch { return -1; } })();
  if (size > DOC_LIMITS.maxBytes) { removeFile(kept.path); return { name, error: `not kept: ${mb(size)}, over the ${MAX_MB} limit` }; }
  if (size < 0 || !isPdf(kept.path)) { removeFile(kept.path); return { name, error: "not kept: the file WhatsApp gave is not a PDF" }; }
  return { name, path: kept.path, size };
}

// --- What was downloaded before ------------------------------------------------------------------

const KNOWN_MAX = 300;
interface Known { name: string; path: string; size: number; at: number }
const knownFile = (dir: string) => join(dir, "whatsapp", "documents.json");

function loadKnown(dir: string): Record<string, Known> {
  try {
    const v = JSON.parse(readFileSync(knownFile(dir), "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

/** The PDF of message `id` downloaded before, when its file is still there at the same size. */
export function knownDocument(dir: string, id: string): DocResult | null {
  if (!dir || !id) return null;
  const k = loadKnown(dir)[id];
  if (!k || typeof k.path !== "string" || !existsSync(k.path)) return null;
  try { if (statSync(k.path).size !== k.size) return null; } catch { return null; }
  return { name: k.name, path: k.path, size: k.size };
}

/** Remembers the PDFs this read downloaded, keeping the newest few hundred. Never fails the read. */
export function rememberDocuments(dir: string, saved: Array<{ id: string; result: DocResult }>): void {
  const fresh = saved.filter((s) => s.id && "path" in s.result);
  if (!dir || !fresh.length) return;
  try {
    const known = loadKnown(dir);
    const now = Date.now();
    for (const s of fresh) {
      const r = s.result as { name: string; path: string; size: number };
      known[s.id] = { name: r.name, path: r.path, size: r.size, at: now };
    }
    const kept = Object.fromEntries(Object.entries(known).sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0)).slice(0, KNOWN_MAX));
    mkdirSync(join(dir, "whatsapp"), { recursive: true });
    writeFileSync(`${knownFile(dir)}.tmp`, JSON.stringify(kept));
    renameSync(`${knownFile(dir)}.tmp`, knownFile(dir));
  } catch { /* the files are kept either way; only the reuse next time is lost */ }
}

// --- One read's documents -------------------------------------------------------------------------

/** What fetching needs from the open page (read-chat gives the real steps; tests give stand-ins). */
export interface DocumentIO {
  /** Marks the download button of message `id`; false when there is none to click. */
  mark(id: string): Promise<boolean>;
  /** Clicks the marked button and answers what Flock kept; throws when no download started. */
  download(): Promise<Kept[]>;
  /** Ms this read may still spend. */
  timeLeftMs(): number;
  /** The skill's data folder (documents.json), "" for none. */
  dataDir: string;
}

/** An error from `download` that ends every download of this read (the person took the window, the
 *  sign-in went), rather than only this one. */
export class StopDownloads extends Error {}

/** Time a download needs beyond its own wait: marking the button and the step's round trips. */
const STEP_MARGIN_MS = 5_000;

/**
 * The documents of `messages`, each answered as a DocResult by message id: PDFs downloaded (newest
 * first, at most 5 a read, each at most 10 MB), PDFs downloaded before given again, and the rest with
 * a short reason. Never throws: a failed download is that document's reason.
 */
export async function fetchDocuments(messages: Message[], io: DocumentIO): Promise<Map<string, DocResult>> {
  const out = new Map<string, DocResult>();
  const docs = messages.map((m) => m.doc).filter((d): d is DocInfo => !!d && !!d.id).reverse();
  const saved: Array<{ id: string; result: DocResult }> = [];
  const toFetch: DocInfo[] = [];
  for (const d of docs) {
    const name = d.name || "document";
    if (out.has(d.id)) continue;
    if (!d.pdf) { out.set(d.id, { name, error: "not downloaded: only PDFs are" }); continue; }
    const known = knownDocument(io.dataDir, d.id);
    if (known) { out.set(d.id, { ...known, name }); continue; }
    const shown = bytesOf(d.size);
    if (shown !== null && shown > DOC_LIMITS.maxBytes) { out.set(d.id, { name, error: `not downloaded: ${mb(shown)}, over the ${MAX_MB} limit` }); continue; }
    if (toFetch.length >= DOC_LIMITS.perRead) { out.set(d.id, { name, error: `not downloaded: at most ${DOC_LIMITS.perRead} a read; read the chat again for the rest` }); continue; }
    toFetch.push(d);
    out.set(d.id, { name, error: "not downloaded" });
  }

  let stopped = "";
  for (const d of toFetch) {
    const name = d.name || "document";
    if (stopped) { out.set(d.id, { name, error: `not downloaded: ${stopped}` }); continue; }
    if (io.timeLeftMs() < DOC_LIMITS.waitMs + STEP_MARGIN_MS) {
      stopped = "no time left in this read; read the chat again later";
      out.set(d.id, { name, error: `not downloaded: ${stopped}` });
      continue;
    }
    let kept: Kept[] = [];
    try {
      if (!(await io.mark(d.id))) { out.set(d.id, { name, error: "not downloaded: its download button was not found" }); continue; }
      kept = await io.download();
    } catch (e: any) {
      if (e instanceof StopDownloads) stopped = e.message;
      out.set(d.id, { name, error: `not downloaded: ${stopped || "WhatsApp did not start the download"}` });
      continue;
    }
    // A file that finished late belongs to the document it is named after, if this read asked for it.
    let mine: Kept | null = null;
    for (const k of kept) {
      if (!mine && sameFile(k.fileName ?? "", d.name)) { mine = k; continue; }
      const owner = toFetch.find((o) => o !== d && o.name && sameFile(k.fileName ?? "", o.name) && !("path" in (out.get(o.id) ?? {})));
      if (owner && toFetch.indexOf(owner) < toFetch.indexOf(d)) {
        const r = checkKept(k, owner.name);
        out.set(owner.id, r);
        saved.push({ id: owner.id, result: r });
      } else removeFile(k.path);
    }
    const result = mine ? checkKept(mine, name) : { name, error: "not downloaded: WhatsApp did not start the download" };
    out.set(d.id, result);
    saved.push({ id: d.id, result });
  }
  rememberDocuments(io.dataDir, saved);
  return out;
}

/** The messages as read-chat answers them: `doc` (the page's) replaced by `document` (the result). */
export function withDocuments(messages: Message[], results: Map<string, DocResult>): Array<Omit<Message, "doc"> & { document?: DocResult }> {
  return messages.map(({ doc, ...m }) => {
    const document = doc ? results.get(doc.id) ?? { name: doc.name || "document", error: "not downloaded" } : undefined;
    return document ? { ...m, document } : m;
  });
}
