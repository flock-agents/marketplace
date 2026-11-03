import { describe, it, expect } from "bun:test";
import { CONNECT_WAIT_MS, trackerConnector } from "./connect";

const zepp = { id: "zepp", name: "Zepp", skillId: "zepp", ready: false };
const setup = (result: { ok: true } | { ok: false; reason: string } = { ok: true }) => {
  const asks: { name: string; skillId: string }[] = [];
  let now = new Date("2026-11-03T08:00:00Z");
  const connect = trackerConnector(async () => [zepp], async (t) => { asks.push(t); return result; }, () => now);
  return { asks, connect, later: (ms: number) => { now = new Date(now.getTime() + ms); } };
};

describe("Connect asks the coach for the tracker", () => {
  it("wakes the coach with the tracker's name and connector", async () => {
    const { asks, connect } = setup();
    expect(await connect("zepp")).toEqual({ asked: true });
    expect(asks).toEqual([{ name: "Zepp", skillId: "zepp" }]);
  });
  it("asks once per wait for the same tracker, then again", async () => {
    const { asks, connect, later } = setup();
    await connect("zepp");
    await connect("zepp");
    expect(asks).toHaveLength(1);
    later(CONNECT_WAIT_MS);
    await connect("zepp");
    expect(asks).toHaveLength(2);
  });
  it("refuses an unknown tracker without waking anyone", async () => {
    const { asks, connect } = setup();
    expect(await connect("fitbit")).toEqual({ error: "Send the id of one of the app's trackers", status: 400 });
    expect(asks).toHaveLength(0);
  });
  it("says why when the coach could not be woken, and lets the next tap try again", async () => {
    const { asks, connect } = setup({ ok: false, reason: "the agent is busy" });
    expect(await connect("zepp")).toEqual({ error: "the agent is busy", status: 502 });
    await connect("zepp");
    expect(asks).toHaveLength(2);
  });
});
