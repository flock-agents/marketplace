import { describe, it, expect } from "bun:test";
import { jobsWake, WAKE_FACTS_BUDGET } from "./agent-jobs";

const job = (id: string, kind: string, facts: unknown) =>
  ({ id, kind, subject: null, facts: JSON.stringify(facts), status: "open", expires_at: "2026-11-01T23:59", asked_at: null } as any);

describe("jobsWake", () => {
  it("stays under the platform's 20,000-character data limit: big facts are left to GET /api/jobs/<id>", () => {
    const big = job("p", "find_patterns", { choices: "x".repeat(29_000) });
    const small = job("r", "review_meal", { dish: "Poha" });
    const w = jobsWake([small, big]) as { message: string; data: { jobs: any[] } };
    expect(JSON.stringify(w.data).length).toBeLessThan(20_000);
    expect(w.message.length).toBeLessThan(4_000);
    expect(w.data.jobs[0].facts).toEqual({ dish: "Poha" });
    expect(w.data.jobs[1]).toMatchObject({ id: "p", facts_at: "/api/jobs/p" });
    expect(w.data.jobs[1].facts).toBeUndefined();
    expect(WAKE_FACTS_BUDGET).toBeLessThan(20_000);
  });
});
