// Renders the step-kinds table (server/kinds.ts, the list plan_done checks against) into server/plan-prep-prompt.md, and copies
// the prompt into flock.app.json as the plan-prep routine's `prompt`. Run after editing either: `bun tests/embed-prompt.ts`.
// server/manifest.test.ts fails when they drift.
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { kindTable } from "../server/kinds";

const root = join(import.meta.dir, "..");
const mdPath = join(root, "server", "plan-prep-prompt.md"), manifestPath = join(root, "flock.app.json");
const markers = /<!-- kinds -->[\s\S]*?<!-- \/kinds -->/;
const source = readFileSync(mdPath, "utf8");
if (!markers.test(source)) throw new Error("plan-prep-prompt.md has no <!-- kinds --> marker pair");
const rendered = source.replace(markers, () => `<!-- kinds -->\n${kindTable()}\n<!-- /kinds -->`);
writeFileSync(mdPath, rendered);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const routine = manifest.routines.find((r: { id: string }) => r.id === "plan-prep");
routine.prompt = rendered.trimEnd();
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`embedded ${routine.prompt.length} characters into the plan-prep routine`);
