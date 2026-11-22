export interface Member { id: string; name: string; colour: string; emoji: string | null; created_at: string; updated_at: string; updated_by: string | null; _sample?: boolean }
export interface Event {
  id: string; title: string; date: string; repeat: string; /** a monthly event: null or "date" (the 6th), "weekday" (the 1st Sunday), "last_weekday" */ monthly_by?: string | null; start_time: string | null; end_time: string | null; who: string | null; location: string | null;
  notes: string | null; reminder_minutes: number | null; kind: string; status: string; added_by: string | null; imported: number;
  created_at: string; updated_at: string; updated_by: string | null; _sample?: boolean;
}
/** An event's to-do, as the app keeps it (GET /api/events/extras). */
export interface Todo { key: string; title: string; due: string; show_from: string; done: boolean; /** Flock's words when someone else had done it ("Already done by Ravi.") */ note?: string }
/** Per event id: where it came from (the sources' labels) and its to-dos. */
export type Extras = Record<string, { sources: string[]; todos: Todo[] }>;
/** What the chat is pointed at: the event or member the viewer last picked. */
export type Selected = { table: string; id: string; label: string } | null;

import { useCallback, useEffect, useState } from "react";
import { REPEATS as REPEAT_LIST, MONTHLY_BY as MONTHLY_BY_LIST, COLOURS as COLOUR_LIST } from "../../server/db/constants";
import { clockLabel, kitFetch, type ToneT } from "../flock/ui";
import { shortDate, weekday } from "./dates";

export const REPEATS: string[] = [...REPEAT_LIST];
export const COLOURS: string[] = [...COLOUR_LIST];
export const REPEAT_LABELS: Record<string, string> = { none: "Once", daily: "Every day", weekly: "Every week", monthly: "Every month", yearly: "Every year" };
export const MONTHLY_BY: string[] = [...MONTHLY_BY_LIST];
export const MONTHLY_BY_LABELS: Record<string, string> = { date: "On the same date (the 6th)", weekday: "On the same weekday (the 1st Sunday)", last_weekday: "On the last weekday (the last Friday)" };
export const COLOUR_LABELS: Record<string, string> = { accent: "App colour", info: "Blue", success: "Green", warning: "Amber", danger: "Red" };

/** The member's tone, for the dot beside their events; neutral for everyone or a name not in the family. */
export const toneOf = (who: string | null, family: Member[]): ToneT => (family.find((m) => m.name === who)?.colour as ToneT | undefined) ?? "neutral";
/** "⚽ Aarav" when the member has an emoji. */
export const memberLabel = (who: string | null, family: Member[]): string => {
  const m = family.find((x) => x.name === who);
  return m?.emoji ? `${m.emoji} ${m.name}` : who ?? "";
};

/** "4:30 pm to 5:00 pm", "4:30 pm", or "All day". */
export const timeLabel = (e: Pick<Event, "start_time" | "end_time">): string =>
  e.start_time ? `${clockLabel(e.start_time)}${e.end_time ? ` to ${clockLabel(e.end_time)}` : ""}` : "All day";
/** "Thu Oct 16" */
export const dayLabel = (date: string): string => `${weekday(date)} ${shortDate(date)}`;
/** "from Shiva's email", "from MyClassBoard and Ankita's email", or "added by Shiva"; empty when neither is known. */
export const sourceLine = (e: Pick<Event, "id" | "added_by">, extras: Extras): string => {
  const sources = extras[e.id]?.sources ?? [];
  return sources.length ? `from ${sources.join(" and ")}` : e.added_by ? `added by ${e.added_by}` : "";
};
/** "2 to-dos" for the ones still open; empty when none. */
export const todoCount = (id: string, extras: Extras): string => {
  const n = (extras[id]?.todos ?? []).filter((t) => !t.done).length;
  return n ? `${n} to-do${n === 1 ? "" : "s"}` : "";
};

/** Each event's sources and to-dos, read again whenever `key` changes (the events as loaded) and after a tick. */
export function useExtras(key: string) {
  const [extras, setExtras] = useState<Extras>({});
  const reload = useCallback(async () => {
    try { setExtras((await kitFetch<{ events: Extras }>("events/extras")).events ?? {}); } catch { /* the list keeps what it had */ }
  }, []);
  useEffect(() => { void reload(); }, [key, reload]);
  return { extras, reload };
}

/** Tick (or untick) an event's to-do: settled in the app and marked done on the family's list in Flock, as the one who ticked it. */
export const setTodoDone = (eventId: string, key: string, done: boolean) =>
  kitFetch<{ ok: boolean; message?: string }>("todos/done", { method: "POST", body: JSON.stringify({ event_id: eventId, key, done }) });

/** Bring back a deleted row through the kit's change log. */
export const undo = (changeId: string, onFail: () => void) => { void kitFetch(`_data/_changes/${changeId}/undo`, { method: "POST" }).catch(onFail); };

/** The form fields for one event. `names` (the family) are suggestions for Who; any name is accepted. */
export const eventFields = (names: string[]) => [
  { type: "text", name: "title", label: "What", required: true, placeholder: "Dentist" },
  { type: "date", name: "date", label: "Date (the first day, when it repeats)", required: true },
  { type: "select", name: "repeat", label: "Repeat", options: REPEATS, optionLabels: REPEAT_LABELS },
  { type: "select", name: "monthly_by", label: "Every month, by (when it repeats monthly)", options: MONTHLY_BY, optionLabels: MONTHLY_BY_LABELS },
  { type: "text", name: "start_time", label: "Starts", placeholder: "16:30, or leave empty for all day" },
  { type: "text", name: "end_time", label: "Ends", placeholder: "17:00" },
  { type: "text", name: "who", label: "Who", options: names, placeholder: "Everyone" },
  { type: "text", name: "location", label: "Where" },
  { type: "number", name: "reminder_minutes", label: "Remind, minutes before", placeholder: "30" },
  { type: "longtext", name: "notes", label: "Notes" },
] as const;

/** The form fields for one family member. */
export const memberFields = [
  { type: "text", name: "name", label: "Name", required: true },
  { type: "text", name: "emoji", label: "Emoji", placeholder: "⚽" },
  { type: "select", name: "colour", label: "Colour", options: COLOURS, optionLabels: COLOUR_LABELS },
] as const;
