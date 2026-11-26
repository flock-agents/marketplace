// The whatsapp package's functions through Flock's REAL skill executor and /api/internal/browser-fetch,
// on the WhatsApp sign-in a browser-tool sign-in made, against the dummy WhatsApp Web (site.ts).
// The scripts open https://web.whatsapp.com/ as shipped: in this run every request to that host is
// answered by the dummy inside Chromium and every other request is aborted, so nothing reaches
// WhatsApp, and no number is ever typed here (the dummy links the window without one).
// Run: tests/whatsapp/dummy/run-flock.sh (skipped without FLOCK_SERVER_DIR).
import { describe, it, expect, beforeAll, beforeEach, afterAll, setDefaultTimeout } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { aborted, enabled, serveDummy, standIns, startFlock, type FlockWorld } from "./_flock-world";
import { whatsappDummy } from "./site";

setDefaultTimeout(300_000);
const HOST = "web.whatsapp.com";
const SITE_URL = `https://${HOST}/`;
const MIN = 60_000;
const dummy = whatsappDummy();
let flock: FlockWorld;
let owner: ReturnType<FlockWorld["agent"]>;
let limitsFile = "";
if (enabled) await standIns();

type Run = { success: boolean; result?: any; error?: string; error_code?: string };
/** One function of the package, as run_skill runs it: Flock's executor, in the owner's own chat. */
async function run(functionName: string, params: Record<string, unknown> = {}): Promise<{ ok: boolean; out: any; raw: Run }> {
  const { executeSkillFunction } = await flock.import("skill-executor");
  const { sessionKeyExport } = await flock.import("session-key");
  const raw: Run = await executeSkillFunction({ skillId: "whatsapp", functionName, agentId: owner.id, params, sessionId: owner.sessionId, sessionType: "owner", sessionKey: sessionKeyExport(owner.sessionId) });
  const text = typeof raw.result === "string" ? raw.result : JSON.stringify(raw.result ?? raw.error ?? "");
  let out: any = raw.result;
  try { out = typeof raw.result === "string" ? JSON.parse(raw.result) : raw.result; } catch { /* not JSON */ }
  // A refusal comes back as Flock's error line, "<CODE>: <message>".
  const refused = !raw.success && /^([A-Z_]+): ([\s\S]*)$/.exec(String(raw.error ?? ""));
  if (refused) out = { error: true, code: refused[1], message: refused[2] };
  if (process.env.WA_DEBUG) console.log(`[${functionName}]`, text.slice(0, 600), raw.error_code ?? "");
  return { ok: raw.success && !out?.error, out, raw };
}

const writeLimits = (state: unknown) => { mkdirSync(join(limitsFile, ".."), { recursive: true }); writeFileSync(limitsFile, JSON.stringify(state)); };
const readLimits = () => JSON.parse(readFileSync(limitsFile, "utf8"));
const windowOf = (text: string) => {
  const id = /windowId: (aw_\w+)/.exec(text)?.[1] ?? "";
  if (!id) throw new Error(`no window opened: ${text.slice(0, 600)}`);
  return id;
};

/** Links WhatsApp as the instructions end: chats showing in a fresh window, then signed_in kind handoff. */
async function link(): Promise<string> {
  const { tool } = owner;
  const w = windowOf((await tool({ action: "open", url: SITE_URL, purpose: "connector" })).text);
  dummy.phone.linkEverySeen();
  for (let i = 0; i < 10 && !/Family/.test((await tool({ action: "read", windowId: w })).text); i++) await Bun.sleep(1500);
  const recorded = await tool({ action: "signed_in", windowId: w, kind: "handoff" });
  await tool({ action: "close", windowId: w });
  return recorded.text;
}

describe.skipIf(!enabled)("the whatsapp functions on Flock's executor and browser-fetch", () => {
  beforeAll(async () => {
    serveDummy(HOST, dummy);
    flock = await startFlock();
    await flock.installWhatsApp();
    owner = flock.agent();
    limitsFile = join(flock.DATA_DIR, "skill-data", "whatsapp", "limits.json");
    expect(await link()).toContain('"service":"whatsapp"');
  });
  beforeEach(() => { if (existsSync(limitsFile)) rmSync(limitsFile); });
  afterAll(async () => {
    const { closeAllAgentBrowsers } = await flock.import("agent-browser");
    await closeAllAgentBrowsers();
    flock.server.stop(true);
  });

  it("list-chats reads the chat list, and says the minutes left today", async () => {
    const { ok, out } = await run("list-chats");
    expect(ok).toBe(true);
    expect(out.chats.map((c: any) => c.name)).toEqual(["Family 🏡", "Mom", "Mommy Bakes", "Announcements"]);
    expect(out.chats[0]).toMatchObject({ kind: "group", unread: 3 });
    expect(out.minutesLeftToday).toBeGreaterThanOrEqual(28);
    expect(readLimits().opens.length).toBe(1);
    expect(readLimits().usage.ms).toBeGreaterThan(0);
  });

  it("read-chat reads one chat by name, and a chat only search finds", async () => {
    const family = await run("read-chat", { chat: "family 🏡", count: 3 });
    expect(family.ok).toBe(true);
    expect(family.out.messages.map((m: any) => m.text)).toEqual(["The cake", "[voice message]", "Dinner at 8?"]);
    const old = await run("read-chat", { chat: "Old Friend" });
    expect(old.ok).toBe(true);
    expect(old.out.messages[0]).toMatchObject({ from: "Old Friend", text: "See you" });
  });

  it("read-chat downloads a chat's PDFs into the agent's downloads folder: the newest 5, none over 10 MB, PDFs only, in the one open", async () => {
    const downloads = join(flock.DATA_DIR, "agents", owner.id, "downloads");
    const { ok, out } = await run("read-chat", { chat: "School Notices", count: 30 });
    expect(ok).toBe(true);
    expect(readLimits().opens.length).toBe(1);
    expect(dummy.docFetches).toEqual(["Exam-Schedule.pdf", "Holiday-List.pdf", "Fees.pdf", "Sports-Day.pdf", "Circular-3.pdf"]);
    const docs = Object.fromEntries(out.messages.filter((m: any) => m.document).map((m: any) => [m.document.name, m.document]));
    for (const name of ["Exam-Schedule.pdf", "Holiday-List.pdf", "Fees.pdf", "Sports-Day.pdf", "Circular-3.pdf"]) {
      expect(docs[name]).toEqual({ name, path: join(downloads, name), size: expect.any(Number) });
      expect(readFileSync(docs[name].path, "latin1").startsWith("%PDF-")).toBe(true);
    }
    expect(docs["Annual-Report.pdf"]).toEqual({ name: "Annual-Report.pdf", error: "not downloaded: 14 MB, over the 10 MB limit" });
    expect(docs["Timetable.docx"]).toEqual({ name: "Timetable.docx", error: "not downloaded: only PDFs are" });
    expect(docs["Circular-1.pdf"].error).toContain("at most 5 a read");
    expect(out.messages.filter((m: any) => m.document).every((m: any) => m.text === "[document]")).toBe(true);

    // The next read gives those 5 again without a click, and downloads the 2 older ones.
    const again = await run("read-chat", { chat: "School Notices", count: 30 });
    expect(again.ok).toBe(true);
    expect(dummy.docFetches.slice(5)).toEqual(["Circular-2.pdf", "Circular-1.pdf"]);
    const paths = again.out.messages.filter((m: any) => m.document?.path).map((m: any) => m.document.path);
    expect(paths.length).toBe(7);
    expect(paths).toContain(join(downloads, "Exam-Schedule.pdf"));
  });

  it("read-chat: a PDF whose download never starts, or far bigger than shown, stays a placeholder with why", async () => {
    const { ok, out } = await run("read-chat", { chat: "PTA Circulars" });
    expect(ok).toBe(true);
    expect(out.messages.map((m: any) => m.document)).toEqual([
      { name: "Broken.pdf", error: "not downloaded: WhatsApp did not start the download" },
      { name: "Minutes.pdf", error: "not kept: 11 MB, over the 10 MB limit" },
    ]);
    expect(existsSync(join(flock.DATA_DIR, "agents", owner.id, "downloads", "Minutes.pdf"))).toBe(false);
  });

  it("search reads chats and messages, never contacts with no chat", async () => {
    const { ok, out } = await run("search", { query: "friend" });
    expect(ok).toBe(true);
    expect(out.chats.map((c: any) => c.name)).toEqual(["Old Friend"]);
    expect(JSON.stringify(out)).not.toContain("Plumber");
  });

  it("send-message sends one message to one existing chat, and refuses anyone not in the chat list", async () => {
    const sent = await run("send-message", { chat: "Mom", text: "Reaching by 8\nKeep dinner warm" });
    expect(sent.ok).toBe(true);
    expect(sent.out).toMatchObject({ chat: "Mom", sent: true });
    expect(dummy.sent.map((s) => ({ chat: s.chat, text: s.text.replace(/\s+/g, " ") }))).toEqual([{ chat: "Mom", text: "Reaching by 8 Keep dinner warm" }]);
    const stranger = await run("send-message", { chat: "Old Friendly Plumber", text: "hi" });
    expect(stranger.ok).toBe(false);
    expect(stranger.out.code).toBe("CHAT_NOT_FOUND");
    const list = await run("send-message", { chat: ["Mom", "Mommy Bakes"], text: "hi" });
    expect(list.out.code).toBe("ONE_RECIPIENT");
    const readOnly = await run("send-message", { chat: "Announcements", text: "hi" });
    expect(readOnly.out.code).toBe("CANNOT_SEND");
    expect(dummy.sent.length).toBe(1);
  });

  it("\"Use here\" is clicked and the read goes on", async () => {
    dummy.showUseHereNext();
    const { ok, out } = await run("list-chats");
    expect(ok).toBe(true);
    expect(out.chats.length).toBe(4);
  });

  it("opens: 10 an hour, refused before WhatsApp loads", async () => {
    const now = Date.now();
    writeLimits({ opens: Array.from({ length: 10 }, (_, i) => now - 50 * MIN + i * MIN), sends: [], usage: { day: "", ms: 0 } });
    const loads = dummy.loads();
    const { ok, out } = await run("list-chats");
    expect(ok).toBe(false);
    expect(out.code).toBe("OPEN_LIMIT_HOUR");
    expect(out.message).toContain("frees up in about 10 minutes");
    expect(dummy.loads()).toBe(loads);
  });

  it("opens: 60 a day", async () => {
    const now = Date.now();
    writeLimits({ opens: Array.from({ length: 60 }, (_, i) => now - 23 * 60 * MIN + i * 10 * MIN), sends: [], usage: { day: "", ms: 0 } });
    const { out } = await run("search", { query: "x" });
    expect(out.code).toBe("OPEN_LIMIT_DAY");
  });

  it("minutes: 30 a day, refused once spent", async () => {
    const { dayOf, timeZoneOf } = await import("../../../skills/whatsapp/scripts/_limits");
    const { getTimezone } = await flock.import("config");
    const day = dayOf(Date.now(), timeZoneOf({ timeZone: getTimezone() }));
    writeLimits({ opens: [], sends: [], usage: { day, ms: 30 * MIN } });
    const { out } = await run("read-chat", { chat: "Mom" });
    expect(out.code).toBe("TIME_LIMIT_DAY");
  });

  it("sends: 5 an hour", async () => {
    const now = Date.now();
    writeLimits({ opens: [], sends: Array.from({ length: 5 }, (_, i) => now - 30 * MIN + i * MIN), usage: { day: "", ms: 0 } });
    const before = dummy.sent.length;
    const { out } = await run("send-message", { chat: "Mom", text: "one more" });
    expect(out.code).toBe("SEND_LIMIT_HOUR");
    expect(dummy.sent.length).toBe(before);
  });

  it("sends: 20 a day", async () => {
    const now = Date.now();
    writeLimits({ opens: [], sends: Array.from({ length: 20 }, (_, i) => now - 23 * 60 * MIN + i * 3 * MIN), usage: { day: "", ms: 0 } });
    const { out } = await run("send-message", { chat: "Mom", text: "one more" });
    expect(out.code).toBe("SEND_LIMIT_DAY");
  });

  it("signed out: the log-in screen marks the sign-in outdated, and the failed run's time still counts", async () => {
    dummy.phone.logOutAll();
    const { ok, out } = await run("list-chats");
    expect(ok).toBe(false);
    expect(out.code).toBe("SESSION_OUTDATED");
    expect(out.message).toContain("minutes of WhatsApp time left today");
    expect(readLimits().usage.ms).toBeGreaterThan(0);
    const { listBrowserSessions, getBrowserSession } = await flock.import("browser-sessions");
    const session = (listBrowserSessions?.() ?? []).find((s: any) => /^whatsapp-agent-/.test(s.name));
    expect(session && getBrowserSession(session.name)?.state).toBe("outdated");
  });

  it("no request left this machine", () => {
    expect(aborted.filter((u) => new URL(u).host !== "egress-proxy.flock.invalid")).toEqual([]);
  });
});
