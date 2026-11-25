// One dishes read on a saved transcript, as Flock runs it (prod tiers): prints the library and seed.
//   bun evals/read-dishes-once.ts <transcript.json>
import { readFileSync } from "fs";
import { appModel } from "./lib/model";
import { SETUP_PARTS } from "../server/setup";
const lines: string[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
let n = 0;
const transcript = lines.map((l) => (/^A:/.test(l) ? `A${++n}: ${l.slice(2).trim()}` : l)).join("\n");
const part = SETUP_PARTS.find((p) => p.id === "dishes")!;
const model = appModel({ upstream: { balanced: "deepseek/deepseek-v4-flash", fast: "deepseek/deepseek-v4-flash" }, prodTiers: true });
const t0 = Date.now();
const r: any = await model({ tier: part.tier, purpose: part.purpose, system: part.system, user: JSON.stringify({ household: {}, transcript }), schema: part.schema, maxTokens: part.maxTokens });
console.log(`${Date.now() - t0} ms`, r.ok ? "" : r.message);
if (r.ok) { console.log("seed:"); for (const s of r.json.seed ?? []) console.log("  ", JSON.stringify(s)); }
