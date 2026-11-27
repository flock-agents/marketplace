// Replay make_plan on a saved planner database with a stand-in model: every request is written out, nothing is sent.
//   bun evals/replay-requests.ts <dataDir with app.db> <outDir>
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { boot } from "../server/testkit";
import type { ModelRequest, ModelResult } from "../server/model";
const [dataDir, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
let n = 0;
const model = async (req: ModelRequest): Promise<ModelResult> => {
  n++;
  const user = (() => { try { return JSON.parse(req.user); } catch { return req.user; } })();
  writeFileSync(join(out, `${String(n).padStart(2, "0")}-${(req.purpose ?? "call").replace(/[^a-z0-9]+/gi, "-")}.json`), JSON.stringify({ tier: req.tier, purpose: req.purpose, system: req.system, user, schema: req.schema }, null, 2));
  if (req.purpose?.includes("contain")) return { ok: true, model: "stub", json: Object.fromEntries((user.dishes ?? []).map((d: string) => [d, Object.fromEntries((user.tags ?? []).map((t: string) => [t, false]))])) };
  if (req.purpose?.startsWith("meal plan: the week's") || req.purpose?.startsWith("meal plan: fix")) {
    const lib = (user.library ?? []).map((d: any) => d.dish);
    const days = Object.fromEntries((user.days ?? []).filter((d: any) => !d.skip).map((d: any, i: number) => [d.date, [...(user.staples ?? []), lib[i % Math.max(1, lib.length)]].filter(Boolean)]));
    return { ok: true, model: "stub", json: { days } };
  }
  return { ok: true, model: "stub", json: { dishes: [] } };
};
const k = await boot({ dataDir, dbFile: join(dataDir, "app.db"), model });
const r = await k.op("make_plan", { week_start: "2026-11-30", ...(process.argv[4] ? { household: JSON.parse(require("fs").readFileSync(process.argv[4], "utf8")) } : {}) });
console.log(JSON.stringify(r).slice(0, 300));
