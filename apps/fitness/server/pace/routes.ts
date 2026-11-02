// GET /api/pace: the pace check's parameters in force and what it would decide right now (nothing is sent), for the coach
// tuning it. Change a parameter with PATCH /api/_app/settings {"pace.<name>": value}.
import { Hono } from "hono";
import type { PaceService } from "./service";

export function paceRoutes(pace: PaceService, todayAsOf: () => string | null) {
  const routes = new Hono();
  routes.get("/pace", (c) => {
    const { ctx, params, verdict } = pace.verdict(todayAsOf());
    return c.json({
      at: ctx.now.toISOString(), date: ctx.today, watchDataReaches: ctx.asOf, nudgesToday: ctx.nudgesToday,
      wouldNudge: verdict.nudge, why: verdict.why, metrics: verdict.metrics,
      params, change: 'PATCH /api/_app/settings {"pace.<name>": <value>}; each setting\'s meaning is its label in GET /api/_app',
    });
  });
  return routes;
}
