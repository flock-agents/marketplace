import { readlinkSync } from "fs";

/** The machine's IANA zone from /etc/localtime ("…/zoneinfo/Asia/Kolkata" -> "Asia/Kolkata"), or null when it cannot be read. */
export function machineZone(readLink: (p: string) => string = readlinkSync): string | null {
  try {
    const m = /zoneinfo\/(.+)$/.exec(readLink("/etc/localtime"));
    return m ? m[1]! : null;
  } catch { return null; }
}

/**
 * `bun test` runs in UTC, which makes the fixtures' `today` lag the model's context date between local midnight and the zone's UTC
 * offset. Pin the process zone to the machine's before any fixture computes a date. A TZ the caller set explicitly (other than the
 * UTC bun test injects) is kept.
 */
export function pinMachineZone(env: Record<string, string | undefined> = process.env, zone: string | null = machineZone()): string | undefined {
  if (zone && (!env.TZ || env.TZ === "UTC")) env.TZ = zone;
  return env.TZ;
}
