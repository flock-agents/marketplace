// A routine's instance id is a UUID the platform assigns and only hands to the routine itself, on each run — an
// app route has no other way to learn it. The shopping-timeline routine remembers its own id here on every tick,
// so "Prep cart for order" (index.ts) can wake that same routine on demand, between ticks, with no manifest change.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const file = (dataDir: string, routineKey: string) => join(dataDir, ".flock", `routine-id.${routineKey}.json`);

export function rememberRoutineId(dataDir: string, id: string, routineKey = "shopping-timeline"): void {
  try {
    mkdirSync(join(dataDir, ".flock"), { recursive: true });
    writeFileSync(file(dataDir, routineKey), JSON.stringify({ id }));
  } catch { /* best effort: the next tick tries again */ }
}

export function readRoutineId(dataDir: string, routineKey = "shopping-timeline"): string | null {
  try {
    if (!existsSync(file(dataDir, routineKey))) return null;
    return (JSON.parse(readFileSync(file(dataDir, routineKey), "utf8")) as { id: string }).id;
  } catch { return null; }
}
