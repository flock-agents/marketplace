// WHEN "BUILD MEMORY" RUNS (ruling R25): the built-in desk's harvest cadence, kept as it was (harvest-runner.ts isHarvestDue,
// emailCadence, harvestHour; memory-relay.ts). The routine is dispatched on new mail, but a run reads only when a harvest is
// OWED: at the person's harvest hour every day, then on each hour of the owner's active window, plus the shoulder runs, in
// the owner's zone. Due-based, not match-based: a machine asleep through several boundaries owes ONE run when it wakes.
// A run that read every kept mail into memory stamps the day (platform-ops recordHarvestRun, `last_harvest:<account>`) at
// the moment it asked, so a run that crosses the next boundary leaves that one owed. "Run now" (a manual run) always runs.
// The first read (lifecycle initialize) never asks.
//
// The window, the interval and the shoulder hours are the platform's (spec §3, §9): Flock hands them on every lifecycle tick
// (TickContext.harvest), and the app keeps the last one. Until a tick has said, the built-in desk's defaults apply (every day
// 09:00-19:00, hourly, shoulder runs at 07, 21 and 23, the process's zone). The morning hour is always the routine's own
// `harvestHour` setting.
import { isCadenceDue, type HarvestCadence } from "@flock/app-sdk";
import { lastHarvestRunAt } from "../platform-ops";
import { processTimezone } from "../lib/local-day";

/** The built-in desk's harvest hour when the routine names none (harvest-runner DEFAULT_HARVEST_HOUR). */
export const DEFAULT_HARVEST_HOUR = 5;
/** The built-in desk's defaults (active-window.ts DEFAULT_ACTIVE_WINDOW, HARVEST_EVERY_HOURS["email-desk"], SHOULDER_HOURS). */
const DEFAULT_WINDOW = { days: [0, 1, 2, 3, 4, 5, 6], start: 9, end: 19 };
const DEFAULT_EVERY_HOURS = 1;
const DEFAULT_SHOULDER_HOURS = [7, 21, 23];

let tickCadence: HarvestCadence | null = null;

/** The platform's cadence from a lifecycle tick (absent on an older Flock: the last one, else the defaults, stay). */
export function noteTickCadence(c: HarvestCadence | undefined): void {
  if (c) tickCadence = c;
}

/** Tests: forget the tick's cadence. */
export function _resetTickCadenceForTesting(): void {
  tickCadence = null;
}

/** The routine's harvest hour: its own setting, strictly a whole hour 0-23 (0 is midnight), else 05:00. */
export function harvestHourOf(settings: Record<string, unknown>): number {
  const raw = settings.harvestHour;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 23 ? raw : DEFAULT_HARVEST_HOUR;
}

/** The routine's settings: its trigger filter, under its values (as follow-up reads its own). */
export function routineSettings(routine: { trigger?: unknown; values?: Readonly<Record<string, unknown>> }): Record<string, unknown> {
  const filter = ((routine.trigger ?? {}) as { filter?: Record<string, unknown> }).filter ?? {};
  return { ...filter, ...(routine.values ?? {}) };
}

/** This mailbox's cadence: the platform's window and interval (or the defaults), the routine's harvest hour. */
export function memoryCadence(harvestHour: number): HarvestCadence {
  if (tickCadence) return { ...tickCadence, morningHour: harvestHour };
  return {
    tz: processTimezone(), window: { ...DEFAULT_WINDOW, days: [...DEFAULT_WINDOW.days] }, everyHours: DEFAULT_EVERY_HOURS,
    extraHours: [...DEFAULT_SHOULDER_HOURS], morningHour: harvestHour,
  };
}

/** Is a memory run owed for this mailbox now? A boundary has passed today and the last finished run predates it. */
export function isMemoryRunDue(accountId: string, now: number, harvestHour: number): boolean {
  return isCadenceDue(lastHarvestRunAt(accountId), now, memoryCadence(harvestHour));
}
