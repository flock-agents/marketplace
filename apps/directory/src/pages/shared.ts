export interface Entry {
  id: string; name: string; kind: string; image: string | null; phone: string | null; url: string | null;
  notes: string | null; created_at: string; updated_at: string; updated_by: string | null;
}
import { KINDS as KIND_LIST } from "../../server/db/constants";
export const KINDS: string[] = [...KIND_LIST];

/** The object drawn on a card or page with no picture. Change it when the kinds change. */
export const KIND_OBJECTS: Record<string, string> = {
  Plumber: "toolbox", Electrician: "light-bulb", Restaurant: "thali", Cafe: "chai-cup",
  "Tiffin service": "tiffin-box", Cleaning: "broom", "Appliance repair": "washing-machine", Nursery: "plant",
};
export const objectFor = (kind: string): string => KIND_OBJECTS[kind] ?? "phone";

/** Does the entry match what was typed? Looks at the name, the kind and the notes. */
export const matches = (e: Entry, q: string): boolean => {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [e.name, e.kind, e.notes].map((s) => String(s ?? "")).some((s) => s.toLowerCase().includes(needle));
};

/** The kinds to offer: the suggestions, then any other kind the entries already use (a kind is free text). */
export const kindsIn = (rows: Pick<Entry, "kind">[]): string[] => {
  const extra = [...new Set(rows.map((r) => r.kind).filter((k) => k && !KINDS.includes(k)))].sort((a, b) => a.localeCompare(b));
  return [...KINDS, ...extra];
};

/** The form fields for one entry. The kind is free text with `kinds` as suggestions (server/db/constants.ts KINDS + those in use). */
export const fieldsFor = (kinds: string[] = KINDS) => [
  { type: "text", name: "name", label: "Name", required: true },
  { type: "text", name: "kind", label: "Kind", options: kinds, placeholder: "Plumber, Doctor, Cafe…" },
  { type: "text", name: "phone", label: "Phone" },
  { type: "url", name: "url", label: "Website" },
  { type: "url", name: "image", label: "Picture link" },
  { type: "longtext", name: "notes", label: "Notes" },
] as const;
export const FIELDS = fieldsFor();
