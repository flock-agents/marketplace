// The wording of a mailbox's setup row, ported verbatim from the built-in desk (email-desk/mailbox-progress.ts
// describeMailboxProgress): same states, same lines, derived from what is really happening so it never claims work after a
// run has stopped. Pure.

/** The mailbox's live run facts the wording is derived from. */
export interface MailboxHarvestFacts {
  running: boolean;
  extracted: number;
  /** Emails read across all runs, so the figure only rises. */
  extractedTotal?: number;
  failed: number;
  /** Rows taken from the journal. Zero means nothing has been delivered yet. */
  claimed: number;
  /** TODOs this mailbox has produced. */
  tasks: number;
  lastRunAt: number | null;
}

export interface MailboxProgressView {
  state: "queued" | "running" | "done" | "error";
  detail?: string;
}

/** The app's own live status for this mailbox: authoritative for "is work underway". */
export interface MailboxInitStatus {
  status?: "not_started" | "in_progress" | "owed" | "done" | "failed";
  activeLabel?: string;
  doneLabel?: string;
  /** Which phase the active label belongs to: only reading is about the email count. */
  phase?: "reading" | "voice" | "drafting";
  updatedAt?: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function describeMailboxProgress(h: MailboxHarvestFacts | null, init?: MailboxInitStatus): MailboxProgressView {
  const read = h ? (h.extractedTotal ?? h.extracted) : 0;

  if (init?.status === "in_progress" || init?.status === "owed") {
    if (init.phase === "voice" || init.phase === "drafting") {
      return { state: "running", detail: init.activeLabel ?? "Setting things up…" };
    }
    return { state: "running", detail: read > 0 ? `Read ${plural(read, "email", "emails")} so far` : (init.activeLabel ?? "Starting") };
  }

  if (init?.status === "done" && init.doneLabel) return { state: "done", detail: init.doneLabel };

  if (!h) {
    if (init?.status === "done") return { state: "done", detail: "Finished reading your email" };
    return { state: "queued", detail: "Waiting to start" };
  }

  if (h.running) return { state: "running", detail: read > 0 ? `Read ${plural(read, "email", "emails")} so far` : "Starting" };
  if (h.failed > 0) return { state: "error", detail: `${plural(h.failed, "email", "emails")} could not be read` };
  if (h.claimed === 0) return { state: "queued", detail: "Waiting for your email" };
  if (read === 0) return { state: "done", detail: "Nothing new to read" };
  const credit = h.tasks > 0 ? ` · ${plural(h.tasks, "TODO", "TODOs")}` : "";
  return { state: "done", detail: `Read ${plural(read, "email", "emails")}${credit}` };
}
