// The NEW-compose sequence shared by createDraft and sendEmail: open Gmail
// fresh, open one compose, tag it, fill it, hand it to the caller's finishing
// step — and on any failure before that step, discard it (never send) and
// close the session. See _composeWindow.ts for the bug this exists to end.
//
// No script entrypoint. The browser is injected (ComposeIo) so the sequence and
// its cleanup are unit-testable; browserComposeIo() is the real one.

import { existsSync } from "fs";
import {
  errorJson,
  checkBrowserFetchError,
  persistentCreate,
  persistentInteractRaw,
  persistentClose,
} from "../../_shared/_google_helpers";
import { gmailViewUrl } from "./_gmailNav";
import { hasTable, bodyToComposeHtml, writeComposeHtmlScript } from "./_bodyHtml";
import {
  MARK_PREEXISTING_COMPOSES_SCRIPT,
  tagNewComposeScript,
  toFieldSelector,
  ccFieldSelector,
  bccFieldSelector,
  subjectFieldSelector,
  bodyFieldSelector,
  fileInputSelector,
  expandRecipientRowScript,
  discardComposeScript,
  newComposeNonce,
  parseComposeReply,
} from "./_composeWindow";

/** Gmail's Compose button. */
export const COMPOSE_BUTTON_SELECTOR = ".T-I.T-I-KE.L3";
/** A REAL page load can take 10-20s on a cold context; the inbox must render before Compose exists. */
export const COMPOSE_BUTTON_WAIT_MS = 25000;
export const FIELD_WAIT_MS = 10000;

export interface ComposeFields {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  attachments?: string[];
}

/** createDraft / sendEmail's SKILL_PARAMS -> ComposeFields. `attachments` is an array or newline-separated paths. */
export function composeFieldsFromParams(params: any): ComposeFields {
  const raw = params?.attachments;
  const attachments: string[] = Array.isArray(raw)
    ? raw.filter((a: any) => a != null && a !== "")
    : typeof raw === "string" && raw
      ? raw.split("\n").filter((a: string) => a.trim() !== "")
      : [];
  return {
    to: params?.to || "",
    subject: params?.subject || "",
    body: params?.body || "",
    cc: params?.cc || "",
    bcc: params?.bcc || "",
    attachments,
  };
}

/** A browser-fetch step that came back >= 400. Carries the raw reply for the caller's error mapping. */
export class ComposeStepError extends Error {
  constructor(readonly httpCode: number, readonly body: any) {
    super(String(body?.message ?? body?.error ?? `browser step failed (HTTP ${httpCode})`));
  }
}

export interface ComposeIo {
  /** Open a held session on `url`; returns its id. */
  open(url: string): Promise<string>;
  /** Run actions (+ an optional trailing evaluate); returns the reply's `content`. Throws ComposeStepError. */
  step(psId: string, actions: any[], evalScript?: string): Promise<unknown>;
  close(psId: string): Promise<void>;
  fileExists(path: string): boolean;
}

export function browserComposeIo(): ComposeIo {
  return {
    open: async (url) => {
      // holdLock: a compose spans several round-trips, and another caller's
      // goto on this shared page between them would tear the compose away.
      const res = await persistentCreate(url, undefined, { holdLock: true });
      return res?.persistentSessionId || "";
    },
    step: async (psId, actions, evalScript) => {
      // Raw, never persistentInteract: that one exits the process on an error,
      // which would skip the discard + close below — the leak behind the bug.
      const { httpCode, body } = await persistentInteractRaw(psId, actions, false, evalScript);
      if (httpCode >= 400) throw new ComposeStepError(httpCode, body);
      return body?.content;
    },
    close: (psId) => persistentClose(psId),
    fileExists: (p) => existsSync(p),
  };
}

/** What the caller's finishing step gets: the session and the tag of the compose it owns. */
export interface OpenCompose {
  psId: string;
  nonce: string;
}

/** The fill steps for one compose, in order. Pure, so the exact sequence is testable. */
export function fillComposeSteps(nonce: string, fields: ComposeFields, fileExists: (p: string) => boolean): any[][] {
  const steps: any[][] = [[
    { action: "click", selector: toFieldSelector(nonce), delay: FIELD_WAIT_MS },
    { action: "insertText", text: fields.to },
    { action: "press", key: "Tab" },
    { action: "wait", delay: 1000 },
  ]];
  const extraRow = (field: "cc" | "bcc", value: string, selector: string) => steps.push([
    { action: "evaluate", script: expandRecipientRowScript(nonce, field) },
    { action: "wait", delay: 500 },
    { action: "click", selector, delay: FIELD_WAIT_MS },
    { action: "insertText", text: value },
    { action: "press", key: "Tab" },
    { action: "wait", delay: 500 },
  ]);
  if (fields.cc) extraRow("cc", fields.cc, ccFieldSelector(nonce));
  if (fields.bcc) extraRow("bcc", fields.bcc, bccFieldSelector(nonce));
  steps.push([
    { action: "click", selector: subjectFieldSelector(nonce), delay: FIELD_WAIT_MS },
    { action: "insertText", text: fields.subject },
    { action: "click", selector: bodyFieldSelector(nonce), delay: FIELD_WAIT_MS },
    // A Markdown table is written as HTML so it is a real table (_bodyHtml.ts).
    hasTable(fields.body)
      ? { action: "evaluate", script: writeComposeHtmlScript(bodyToComposeHtml(fields.body)) }
      : { action: "insertText", text: fields.body },
    { action: "wait", delay: 1000 },
  ]);
  for (const raw of fields.attachments ?? []) {
    const path = raw.trim();
    if (!path || !fileExists(path)) continue;
    steps.push([
      { action: "upload", selector: fileInputSelector(nonce), filePath: path },
      { action: "wait", delay: 2000 },
    ]);
  }
  return steps;
}

/**
 * Open a fresh compose, fill it, and run `finish` on it. On any failure BEFORE
 * `finish` starts, the compose is discarded (best-effort, never sent); the
 * session is closed on every path. Errors are rethrown for the caller to report.
 *
 * Once `finish` starts the compose is the caller's: a failed save-and-close may
 * still have left a complete draft, and a failed Send may already have sent —
 * neither may be discarded on a guess.
 */
export async function withNewCompose<T>(
  io: ComposeIo,
  fields: ComposeFields,
  finish: (open: OpenCompose) => Promise<T>,
  nonce: string = newComposeNonce(),
): Promise<T> {
  // gmailViewUrl forces a real document load: any compose a previous call left
  // open is gone, instead of being inherited through a fragment-only goto.
  const psId = await io.open(gmailViewUrl("#inbox"));
  if (!psId) throw new Error("Failed to create persistent session for Gmail");
  let composeOpen = false;
  let finishing = false;
  try {
    const tagged = parseComposeReply(await io.step(psId, [
      { action: "waitForSelector", selector: COMPOSE_BUTTON_SELECTOR, delay: COMPOSE_BUTTON_WAIT_MS },
      { action: "evaluate", script: MARK_PREEXISTING_COMPOSES_SCRIPT },
      { action: "click", selector: COMPOSE_BUTTON_SELECTOR },
    ], tagNewComposeScript(nonce)));
    // Clicked Compose: from here a window may exist even if it was never tagged.
    composeOpen = true;
    if (tagged.ok !== true) throw new Error(`Gmail's compose window did not open (${tagged.reason || "unknown"})`);

    for (const actions of fillComposeSteps(nonce, fields, io.fileExists)) {
      await io.step(psId, actions);
    }
    finishing = true;
    return await finish({ psId, nonce });
  } catch (err) {
    if (composeOpen && !finishing) {
      await io.step(psId, [], discardComposeScript(nonce)).catch(() => {});
    }
    throw err;
  } finally {
    await io.close(psId).catch(() => {});
  }
}

/** Report a withNewCompose failure the way every other gmail script reports one, then exit. */
export function reportComposeFailure(err: unknown, what: string): never {
  if (err instanceof ComposeStepError) checkBrowserFetchError(err.httpCode, err.body, "BROWSER_ERROR", what);
  const message = err instanceof Error ? err.message : String(err);
  errorJson("BROWSER_ERROR", `${what} failed: ${message}`);
}

/** Read a script's JSON result out of a step's content; null when it is not JSON. */
export function parseResultJson(content: unknown): any {
  if (content && typeof content === "object") return content;
  try { return JSON.parse(typeof content === "string" ? content : "{}"); }
  catch { return null; }
}
