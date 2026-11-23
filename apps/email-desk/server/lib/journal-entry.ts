// The journal row shape the memory filter reads, copied as plain types from Flock's ingest-db
// (type-only: the app holds no journal database).
export type EventKind = "email" | "message" | "mention";

export interface JournalEntry {
  sourceId: string;
  accountId: string;
  eventId: string;
  kind: EventKind;
  actor: Record<string, unknown>;
  threadKey: string | null;
  ts: number;
  preview: string;
  permalink: string | null;
  raw: Record<string, unknown>;
}

export interface StoredJournalEntry extends JournalEntry {
  id: string;
  createdAt: number;
}
