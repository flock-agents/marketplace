export interface Member { id: string; name: string; colour: string; emoji: string | null; created_at: string; updated_at: string; updated_by: string | null; _sample?: boolean }
export interface Event {
  id: string; title: string; date: string; start_time: string | null; end_time: string | null; who: string | null; location: string | null;
  notes: string | null; reminder_minutes: number | null; created_at: string; updated_at: string; updated_by: string | null; _sample?: boolean;
}
export interface Reminder { id: string; title: string; due: string; repeat: string; who: string | null; created_at: string; updated_at: string; updated_by: string | null; _sample?: boolean }
/** What the chat is pointed at: the event, reminder or member the viewer last picked. */
export type Selected = { table: string; id: string; label: string } | null;

import { REPEATS as REPEAT_LIST, COLOURS as COLOUR_LIST } from "../../server/db/constants";
import { clockLabel, kitFetch, relativeDate, type ToneT } from "../flock/ui";
import { shortDate, splitDue, weekday } from "./dates";

export const REPEATS: string[] = [...REPEAT_LIST];
export const COLOURS: string[] = [...COLOUR_LIST];
export const REPEAT_LABELS: Record<string, string> = { none: "Once", daily: "Every day", weekly: "Every week", monthly: "Every month" };
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
/** "Tomorrow 7:30 am", "Thu Oct 16 7:30 am"; with the date relative to `now`. */
export const whenLabel = (due: string, now: string): string => {
  const { date, time } = splitDue(due);
  const day = relativeDate(date, now);
  return `${/^(Today|Tomorrow|Yesterday)$/.test(day) ? day : dayLabel(date)} ${clockLabel(time)}`;
};
/** "2026-10-16T08:05": the local date and time now, the shape a reminder's `due` has. */
export const nowLocal = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

/** Bring back a deleted row through the kit's change log. */
export const undo = (changeId: string, onFail: () => void) => { void kitFetch(`_data/_changes/${changeId}/undo`, { method: "POST" }).catch(onFail); };

/** The form fields for one event. `names` (the family) are suggestions for Who; any name is accepted. */
export const eventFields = (names: string[]) => [
  { type: "text", name: "title", label: "What", required: true, placeholder: "Dentist" },
  { type: "date", name: "date", label: "Date", required: true },
  { type: "text", name: "start_time", label: "Starts", placeholder: "16:30, or leave empty for all day" },
  { type: "text", name: "end_time", label: "Ends", placeholder: "17:00" },
  { type: "text", name: "who", label: "Who", options: names, placeholder: "Everyone" },
  { type: "text", name: "location", label: "Where" },
  { type: "number", name: "reminder_minutes", label: "Remind, minutes before", placeholder: "60" },
  { type: "longtext", name: "notes", label: "Notes" },
] as const;

/** The form fields for one reminder: a date and a time, joined into `due` on save. */
export const reminderFields = (names: string[]) => [
  { type: "text", name: "title", label: "Remind us to", required: true, placeholder: "Pack the PE kit" },
  { type: "date", name: "date", label: "From", required: true },
  { type: "text", name: "time", label: "At", required: true, placeholder: "07:30" },
  { type: "select", name: "repeat", label: "Repeat", options: REPEATS, optionLabels: REPEAT_LABELS },
  { type: "text", name: "who", label: "Who", options: names, placeholder: "Everyone" },
] as const;

/** The form fields for one family member. */
export const memberFields = [
  { type: "text", name: "name", label: "Name", required: true },
  { type: "text", name: "emoji", label: "Emoji", placeholder: "⚽" },
  { type: "select", name: "colour", label: "Colour", options: COLOURS, optionLabels: COLOUR_LABELS },
] as const;
