// The app's own routes (server/routes/voice.ts, server/removal.ts). Relative paths: the page is served under /a/<appId>/.

export type VoiceState = "ready" | "learning" | "none";

export interface VoiceRow {
  dimension: string;
  part?: "phrases" | "abbreviations";
  label: string;
  value: string;
  examples: string[];
  editedByYou?: boolean;
  basis?: string;
}

export interface VoiceAccount {
  accountId: string;
  email: string | null;
  state: VoiceState;
  learningUntil?: string;
  groups: Array<{ title: string; rows: VoiceRow[] }>;
  notLearned: string[];
  forgotten: Array<{ label: string; dimension: string }>;
}

export type VoiceChange =
  | { accountId: string; action: "relearn" }
  | { accountId: string; dimension: string; action: "forget" | "restore" }
  | { accountId: string; dimension: string; part?: VoiceRow["part"]; action: "edit"; value: string };

const TRY_AGAIN = "That did not work. Try again.";

async function call<T>(path: string, init: RequestInit | undefined, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    throw new Error(fallback);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(body.error || fallback);
  return body;
}

const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

export async function loadVoice(): Promise<VoiceAccount[]> {
  const body = await call<{ accounts?: VoiceAccount[] }>("api/voice", undefined, "Your voice could not be loaded.");
  return body.accounts ?? [];
}

export async function changeVoice(change: VoiceChange): Promise<void> {
  await call("api/voice", json("PUT", change), TRY_AGAIN);
}

export async function deleteMailData(): Promise<void> {
  await call("api/mail-data/delete", json("POST", { confirm: true }), TRY_AGAIN);
}
