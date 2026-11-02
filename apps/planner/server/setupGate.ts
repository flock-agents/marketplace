// Nothing runs until the family has told the app about themselves (owner 2026-11-02). A plan, a shopping list or a job
// built without that is noise, however full the app looks, so the gate is not "has rows" but the household profile: the
// `household.profile` setting, written only from the family's own words (the agent saving what the family told it in
// their first conversation, or Flock's install of an app the owner planned with the Flock Assistant). Until it is set every routine
// is a silent no-op and nothing is queued for the agent; everything already in the app is treated as a sample.
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Database } from "bun:sqlite";

export const PROFILE_KEY = "household.profile";

/** True once the household profile is set. */
export function householdKnown(sqlite: Database): boolean {
  try {
    const row = sqlite.query(`SELECT value FROM _settings WHERE key = ?`).get(PROFILE_KEY) as { value: string | null } | null;
    const v = row?.value ? JSON.parse(row.value) : null;
    return !!v && typeof v === "object" && Object.keys(v).length > 0;
  } catch {
    return false;   // a boot before the schema landed: nothing is known yet
  }
}

type Handler<C> = (ctx: C) => void | Promise<void>;

/** The routines, each a silent no-op until the household is known. */
export function gateRoutines<C extends { kit: { sqlite: Database } }>(routines: Record<string, Handler<C>>): Record<string, Handler<C>> {
  return Object.fromEntries(Object.entries(routines).map(([id, run]) =>
    [id, (ctx: C) => (householdKnown(ctx.kit.sqlite) ? run(ctx) : undefined)]));
}

/** Once per install, at the first boot with this gate:
 *  - an install the owner already set up (its own diners, no samples left), or one Flock made with the family's diners in its
 *    install import, keeps running: its profile is recorded;
 *  - any other install without a profile has every row nobody in the family wrote (the template's samples, and whatever
 *    the app and its agent generated before this gate existed) marked as a sample: shown as one, ignored by the app, and
 *    removed with the rest of the samples once the household is known. The owner's own rows (`user:` stamps, and the
 *    install import's) stay. */
export function settleExistingInstall(sqlite: Database, tables: Iterable<string>, dataDir: string): "known" | "marked" | "already" {
  const marker = join(dataDir, ".flock", "household-check.json");
  if (existsSync(marker)) return "already";
  let outcome: "known" | "marked" = "known";
  if (!householdKnown(sqlite)) {
    const samples = (sqlite.query(`SELECT count(*) n FROM _samples`).get() as { n: number }).n;
    const diners = (sqlite.query(`SELECT count(*) n FROM diners`).get() as { n: number }).n;
    const owners = ownerStamps(sqlite);
    const importedDiners = owners.length ? (sqlite.query(`SELECT count(*) n FROM diners WHERE updated_by IN (${owners.map(() => "?").join(",")})`)
      .get(...owners) as { n: number }).n : 0;
    if ((samples === 0 && diners > 0) || importedDiners > 0) writeProfile(sqlite, { note: "the family's diners were already in the app" }, "app");
    else { markUnclaimedRows(sqlite, tables, owners); outcome = "marked"; }
  }
  mkdirSync(join(dataDir, ".flock"), { recursive: true });
  writeFileSync(marker, JSON.stringify({ outcome, at: new Date().toISOString() }));
  return outcome;
}

/** The stamps an install import wrote its rows with (the kit's `agent:<by>`): the owner's details, taken down when the app was
 *  made, so never a sample. */
function ownerStamps(sqlite: Database): string[] {
  try {
    return (sqlite.query(`SELECT DISTINCT by FROM _imports`).all() as { by: string }[]).map((r) => (r.by.includes(":") ? r.by : `agent:${r.by}`));
  } catch { return []; }
}

function markUnclaimedRows(sqlite: Database, tables: Iterable<string>, owners: string[]): void {
  const now = new Date().toISOString();
  const keep = owners.length ? ` AND updated_by NOT IN (${owners.map((_, i) => `?${i + 3}`).join(",")})` : "";
  sqlite.transaction(() => {
    for (const t of tables) {
      sqlite.query(
        `INSERT OR IGNORE INTO _samples (id, created_at, updated_at, updated_by, table_name, row_id)
         SELECT lower(hex(randomblob(16))), ?1, ?1, 'app', ?2, id FROM "${t.replace(/"/g, '""')}"
         WHERE updated_by IS NULL OR (updated_by NOT LIKE 'user:%'${keep})`,
      ).run(now, t, ...owners);
    }
  })();
}

function writeProfile(sqlite: Database, profile: Record<string, unknown>, by: string): void {
  const now = new Date().toISOString();
  sqlite.query(
    `INSERT INTO _settings (id, created_at, updated_at, updated_by, key, value, scope) VALUES (lower(hex(randomblob(16))), ?1, ?1, ?2, ?3, ?4, 'owner')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).run(now, by, PROFILE_KEY, JSON.stringify(profile));
}

/** The template's samples go the moment the household is known (as Flock's own install does after it adds the owner's
 *  rows), so nothing the app then plans, buys or asks the agent about is a sample. Cleared as whoever told the app about
 *  the household, through the kit's own route: one change group the owner can undo. */
export async function clearSamplesAs(hono: { request(path: string, init: RequestInit): Response | Promise<Response> }, by: string): Promise<void> {
  const [kind, id] = [by.slice(0, by.indexOf(":")), by.slice(by.indexOf(":") + 1)];
  const header = kind === "agent" ? "x-flock-agent" : kind === "user" ? "x-flock-user" : null;
  if (!header || !id) return;   // the app's own write: nothing the family said
  await hono.request("/api/_data/_samples/clear", { method: "POST", headers: { [header]: id } });
}
