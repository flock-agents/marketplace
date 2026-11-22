import { createFlockApp } from "@flock/app-sdk";
import { mountKit, schemaModeFromEnv } from "@flock/app-kit";
import * as schema from "./db/schema";
import { seed } from "./db/seed";
import { prepareV1Data } from "./db/migrate-v1";
import { prepareV2Data, finishV2Data, finishV1Todos } from "./db/migrate-v2";
import { agentOps, closest } from "./agentOps";
import { mountEventRoutes } from "./events";
import { routines } from "./routines";
import { ensureInternalTables, INTERNAL_TABLES, PRIVATE_TABLES, syncTodos, type KitLike } from "./calendar";

let kitRef: KitLike | null = null;
const now = () => new Date();
// The app's operations for its agent (agentOps.ts): Flock relays the agent's calls to them, each with its platform.
const flock = createFlockApp({ ops: agentOps(() => flock.hono, () => {
  if (!kitRef) throw new Error("the app is still starting");
  return { kit: kitRef, now };
}) });
const apply = schemaModeFromEnv() === "apply";
// An install updated from 1.x: its tables move aside (kept) and their rows become the boot import mountKit applies.
const v1 = prepareV1Data(flock.env.dataDir, { writeImport: apply });
// An install updated from 2.x: its reminders table moves aside (kept); its rows become deadline events once the kit is up.
const v2 = prepareV2Data(flock.env.dataDir);
const kit = await mountKit(flock, { schema, seed, keepTables: [...v1.keep, ...v2.keep, ...INTERNAL_TABLES], privateTables: PRIVATE_TABLES, routines });
ensureInternalTables(kit.sqlite);
kitRef = kit;
if (apply && kit.status.state !== "blocked") { finishV2Data(kit); finishV1Todos(kit); }
// Many events in one call (add_events), the pages' extras and a tick; the pages and single-row edits use /api/_data.
mountEventRoutes(flock.hono, kit, { now, near: closest, platform: () => flock.platform as any });
flock.listen();
// To-dos written while Flock was away (or carried over by the update) go once the app is up; the hourly plan-prep run retries.
setTimeout(() => { void syncTodos({ kit, now, platform: () => flock.platform as any }).catch((e) => console.warn(`[family-calendar] to-do sync: ${(e as Error).message}`)); }, 5_000);
