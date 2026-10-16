// downloadAttachment — save a thread's attachments as local files the agent can read (owner
// 2026-10-11, KITS). A READ: it opens the thread's print view (which leaves the thread unread),
// collects its attachment links, and fetches each as a download; the platform keeps what the
// page downloads in the agent's own downloads folder and reports { fileName, path, size }.

import { errorJson, requireBrowserSession, validateId, persistentCreate, persistentInteractRaw, persistentClose } from "../../_shared/_google_helpers";
import { printViewUrl } from "./_printView";
import { ATTACHMENT_LINKS_EXPR, attachmentsFromLinks, pickAttachments, type AttachmentLink } from "./_attachments";

/** At most this many files per call: a thread full of attachments is read a few at a time. */
const MAX_FILES = 10;

if (process.env.SKILL_PARAMS !== undefined) {
  void runScript();
}

async function runScript(): Promise<void> {
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
  const threadId: string = params.threadId || params.messageId || "";
  requireBrowserSession();
  if (!threadId) errorJson("MISSING_PARAM", "threadId is required");
  validateId(threadId, "threadId");

  let psId = "";
  let failure: { code: string; message: string } | null = null;
  let out: Record<string, unknown> | null = null;
  try {
    const page = await persistentCreate(printViewUrl(threadId), [
      { action: "waitForSelector", selector: "table.message", delay: 20000 },
      { action: "evaluate", script: ATTACHMENT_LINKS_EXPR },
    ]);
    psId = page?.persistentSessionId || "";
    if (!psId) throw Object.assign(new Error("Failed to open the thread"), { code: "SESSION_ERROR" });
    let links: AttachmentLink[] = [];
    try { links = JSON.parse(typeof page?.content === "string" ? page.content : "[]"); } catch { links = []; }
    const all = attachmentsFromLinks(Array.isArray(links) ? links : []);
    if (!all.length) throw Object.assign(new Error("This thread has no attachments Gmail lets you download."), { code: "NO_ATTACHMENTS" });
    const wanted = pickAttachments(all, { name: params.name, index: params.index });
    if (!wanted.length) throw Object.assign(new Error(`No attachment matches. This thread has: ${all.map((a) => a.name).join("; ")}`), { code: "NOT_FOUND" });
    const files: unknown[] = [];
    for (const a of wanted.slice(0, MAX_FILES)) {
      // A navigation on the same signed-in page; the download it starts is kept by the platform.
      const { httpCode, body } = await persistentInteractRaw(psId, [], false, undefined, a.url);
      const kept = Array.isArray(body?.downloads) ? body.downloads : [];
      if (httpCode >= 400) files.push({ name: a.name, error: `Gmail refused the download (HTTP ${httpCode})` });
      else if (!kept.length) files.push({ name: a.name, error: "Gmail did not start a download for this attachment" });
      else for (const d of kept) files.push({ name: a.name, ...d });
    }
    out = {
      threadId,
      attachments: all.map((a) => a.name),
      files,
      ...(wanted.length > MAX_FILES ? { note: `Only the first ${MAX_FILES} were downloaded; ask for the rest by name or index.` } : {}),
    };
  } catch (e: any) {
    failure = { code: typeof e?.code === "string" ? e.code : "DOWNLOAD_FAILED", message: e?.message || String(e) };
  } finally {
    if (psId) await persistentClose(psId).catch(() => {});
  }
  // errorJson ends the process: only once the page is closed.
  if (failure) errorJson(failure.code, failure.message);
  console.log(JSON.stringify(out));
}
