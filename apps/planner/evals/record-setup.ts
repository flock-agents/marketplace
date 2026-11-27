// Record (or replay) apply_setup's model answers on a saved transcript. bun evals/record-setup.ts <results-dir> <hid> <rep> <out.json> [--replay]
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { appModel, DEFAULT_UPSTREAM } from "./lib/model";
import { ALL_HOUSEHOLDS } from "./households";
import { bootPlanner, runSetup } from "./lib/adapter";
import { scoreSetup } from "./lib/score-setup";
const [dir, hid, rep, out] = process.argv.slice(2);
const replay = process.argv.includes("--replay");
const h = ALL_HOUSEHOLDS.find((x) => x.id.startsWith(hid))!;
const tr = JSON.parse(readFileSync(join(dir, "transcripts", `${h.id}-rep${rep}.json`), "utf8"));
const rec: any[] = replay ? JSON.parse(readFileSync(out, "utf8")) : [];
const used = new Set<number>();
const real = appModel({ upstream: { balanced: DEFAULT_UPSTREAM, fast: DEFAULT_UPSTREAM, best: DEFAULT_UPSTREAM }, prodTiers: true });
const model = async (req: any) => {
  if (replay) {
    const i = rec.findIndex((c, j) => !used.has(j) && c.purpose === req.purpose && c.user === req.user);
    if (i < 0) { console.error("MISS", req.purpose); return { ok: false, code: "unavailable", message: "no recorded answer" }; };
    used.add(i); return rec[i].result;
  }
  const result = await real(req);
  rec.push({ purpose: req.purpose, user: req.user, result });
  return result;
};
const dataDir = mkdtempSync(join(tmpdir(), "planner-rec-"));
try {
  const k = await bootPlanner({ dataDir, model });
  const { res, setup } = await runSetup(k, h, tr.lines);
  const sc = scoreSetup(h, setup, { transcript: tr.lines });
  console.log(JSON.stringify({ rates: Object.fromEntries(Object.entries(sc.rates).filter(([, [p, n]]: any) => p < n)), notes: sc.notes.filter((n) => /hard_rules|dish_frequency/.test(n)), dropped: res.dropped }, null, 1));
} finally { rmSync(dataDir, { recursive: true, force: true }); if (!replay) writeFileSync(out, JSON.stringify(rec, null, 1)); }
