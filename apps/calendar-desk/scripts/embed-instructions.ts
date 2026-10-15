// Copies planning-instructions.md into flock.app.json, as the plan_events intent's `instructions`.
// Run after editing the .md: `bun run scripts/embed-instructions.ts`. manifest.test.ts fails when the two drift.
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { kindTable } from "../server/kinds";

const root = join(import.meta.dir, "..");
const manifestPath = join(root, "flock.app.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const intent = manifest.agentInterface?.intents?.find((i: { name: string }) => i.name === "plan_events");
if (!intent) throw new Error("flock.app.json has no plan_events intent");
// The kinds table is rendered from server/kinds.ts, the list the validator uses; the .md shows it too.
const mdPath = join(root, "planning-instructions.md");
const markers = /<!-- kinds -->[\s\S]*?<!-- \/kinds -->/;
const source = readFileSync(mdPath, "utf8");
if (!markers.test(source)) throw new Error("planning-instructions.md has no <!-- kinds --> marker pair");
const rendered = source.replace(markers, () => `<!-- kinds -->\n${kindTable()}\n<!-- /kinds -->`);
// Flock drops (with only a server warning) per-intent instructions longer than its INTENT_INSTRUCTIONS_MAX
// (64k since flock 9f17f6213; 20k before, which silently cost the agent every planning rule).
const FLOCK_INTENT_INSTRUCTIONS_MAX = 64_000;
if (rendered.length > FLOCK_INTENT_INSTRUCTIONS_MAX) throw new Error(`planning-instructions.md is ${rendered.length} chars; Flock keeps at most ${FLOCK_INTENT_INSTRUCTIONS_MAX}`);
writeFileSync(mdPath, rendered);
intent.instructions = rendered;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`embedded ${intent.instructions.length} characters into plan_events`);
