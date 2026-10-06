// Copies planning-instructions.md into flock.app.json, as the plan_events intent's `instructions`.
// Run after editing the .md: `bun run scripts/embed-instructions.ts`. manifest.test.ts fails when the two drift.
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const manifestPath = join(root, "flock.app.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const intent = manifest.agentInterface?.intents?.find((i: { name: string }) => i.name === "plan_events");
if (!intent) throw new Error("flock.app.json has no plan_events intent");
intent.instructions = readFileSync(join(root, "planning-instructions.md"), "utf8");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`embedded ${intent.instructions.length} characters into plan_events`);
