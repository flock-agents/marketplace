// The test kit's stand-ins for the platform: the agent asks it records, and the per-key timer it holds until settled.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";

describe("boot", () => {
  it("holds the latest run for a key until settle, and runs each key once", async () => {
    const k = await boot();
    const ran: string[] = [];
    k.deps.schedule("a", () => ran.push("a1"), 20_000);
    k.deps.schedule("a", () => ran.push("a2"), 20_000);
    k.deps.schedule("b", () => ran.push("b"), 20_000);
    expect(k.pending("a")).toBe(true);
    k.settle("a");
    expect(ran).toEqual(["a2"]);
    expect(k.pending("a")).toBe(false); expect(k.pending()).toBe(true);
    k.settle();
    k.settle();
    expect(ran).toEqual(["a2", "b"]);
    expect(k.pending()).toBe(false);
  });

  it("records what the app asks the agent and answers as the test says; the base path defaults to /a/t", async () => {
    const k = await boot({ askAgent: async () => ({ ok: true }) });
    expect(k.deps.basePath).toBe("/a/t");
    expect(await k.deps.askAgent("sync-cart", { app: "zepto" })).toEqual({ ok: true });
    expect(k.asked).toEqual([{ intent: "sync-cart", payload: { app: "zepto" } }]);
    expect((await boot({ basePath: "/a/xyz" })).deps.basePath).toBe("/a/xyz");
  });
});
