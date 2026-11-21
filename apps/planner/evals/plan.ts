// Plan eval: bun apps/planner/evals/plan.ts [--fixtures run11,colliding-rules] [--repeats 3] [--rounds 3] [--model claude-sonnet-5]
//   [--config-dir <real claude config dir>]   (see README.md)
import { runInAssembledApp } from "./lib/prepare";
process.exit(await runInAssembledApp("plan-inner.ts", process.argv.slice(2)));
