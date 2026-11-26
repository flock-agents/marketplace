// The Sign-in section of skills/whatsapp/instructions.md, step by step, through Flock's REAL browser
// tool (open, act, sign_in, read, close, signed_in, hand_to_owner) and routes, against the dummy
// WhatsApp Web (site.ts) on https://web.whatsapp.test: a host that exists nowhere, the package
// installed with that loginUrl. No model: the test makes the calls the instructions tell the agent
// to make. Run: tests/whatsapp/dummy/run-flock.sh (skipped without FLOCK_SERVER_DIR).
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test";
import { aborted, enabled, serveDummy, standIns, startFlock, type FlockWorld } from "./_flock-world";
import { whatsappDummy } from "./site";

setDefaultTimeout(300_000);
const HOST = "web.whatsapp.test";
const SITE_URL = `https://${HOST}/`;
const NUMBER = "+91 98765 43210";
const dummy = whatsappDummy({ boxKeepsCountryCode: false });
let flock: FlockWorld;
let owner: ReturnType<FlockWorld["agent"]>;
if (enabled) await standIns();

const windowOf = (text: string) => {
  const id = /windowId: (aw_\w+)/.exec(text)?.[1] ?? "";
  if (!id) throw new Error(`no window opened: ${text.slice(0, 600)}`);
  return id;
};
/** The code the page shows, read back from the tool's text: its characters joined in order. */
const codeIn = (text: string, code: string) => text.replace(/[\s-]/g, "").includes(code);

type Tool = (args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>;

async function readUntil(tool: Tool, windowId: string, words: RegExp): Promise<string> {
  let text = "";
  for (let i = 0; i < 8; i++) {
    text = (await tool({ action: "read", windowId })).text;
    if (words.test(text)) return text;
    if (process.env.WA_DEBUG) console.log("[read]", text.slice(0, 1500));
    await Bun.sleep(2000);
  }
  throw new Error(`the window never showed ${words}: ${text.slice(0, 400)}`);
}

describe.skipIf(!enabled)("the WhatsApp sign-in, as instructions.md says, on Flock's browser tool", () => {
  beforeAll(async () => {
    serveDummy(HOST, dummy);
    flock = await startFlock();
    await flock.installWhatsApp(SITE_URL);
    owner = flock.agent(`My WhatsApp number is ${NUMBER}.`);
  });
  afterAll(async () => {
    const { closeAllAgentBrowsers } = await flock.import("agent-browser");
    await closeAllAgentBrowsers();
    flock.server.stop(true);
  });

  it("with the box keeping \"+91 \" in its value, as the saved page's does, sign_in sends nothing and says to ask the owner", async () => {
    dummy.options.boxKeepsCountryCode = true;
    const { tool } = owner.chat();
    const w = windowOf((await tool({ action: "open", url: SITE_URL, purpose: "connector" })).text);
    await readUntil(tool, w, /Scan to log in/);
    const sent = await tool({ action: "sign_in", windowId: w, identifier: NUMBER });
    expect(sent.text).toContain("The box didn't hold exactly the number after typing");
    expect(dummy.numbersAsked).toEqual([]);
    await tool({ action: "close", windowId: w });
    dummy.options.boxKeepsCountryCode = false;
  });

  it("code first: sign_in sends the number, the agent reads the code, the link is recorded on a reopened window", async () => {
    const { id, tool } = owner.chat();

    const opened = await tool({ action: "open", url: SITE_URL, purpose: "connector" });
    expect(opened.isError).toBe(false);
    const first = windowOf(opened.text);
    await readUntil(tool, first, /Scan to log in/);

    // Typing the number with act is refused: that is why the instructions use sign_in.
    await tool({ action: "act", windowId: first, steps: [{ action: "click", text: "Log in with phone number" }] });
    await readUntil(tool, first, /Enter phone number/);
    const typed = await tool({ action: "act", windowId: first, steps: [{ action: "type", selector: '[data-testid="phone-number-input"]', text: "9876543210" }] });
    expect(typed.isError).toBe(true);
    expect(dummy.numbersAsked).toEqual([]);
    await tool({ action: "act", windowId: first, steps: [{ action: "click", text: "Log in with QR code" }] });
    await readUntil(tool, first, /Scan to log in/);

    const sent = await tool({ action: "sign_in", windowId: first, identifier: NUMBER });
    expect(dummy.numbersAsked).toEqual(["+919876543210"]);
    expect(sent.text).toStartWith("The site asked for a code.");
    expect(sent.text).toContain("ask the owner for it");

    const [code] = dummy.pendingCodes();
    const shown = await readUntil(tool, first, /Enter code on phone/);
    expect(codeIn(shown, code)).toBe(true);

    expect(dummy.phone.enterCode(code)).toBe(true);
    await readUntil(tool, first, /Family/);
    const refused = await tool({ action: "signed_in", windowId: first, kind: "handoff" });
    expect(refused.text).toContain("NOT signed in");

    await tool({ action: "close", windowId: first });
    const again = windowOf((await tool({ action: "open", url: SITE_URL, purpose: "connector" })).text);
    await readUntil(tool, again, /Family/);
    const recorded = await tool({ action: "signed_in", windowId: again, kind: "handoff" });
    if (process.env.WA_DEBUG) console.log("[signed_in]", recorded.text);
    expect(recorded.isError).toBe(false);
    expect(recorded.text).toContain("Recorded");

    const { readAgentConnection } = await flock.import("agent-connections");
    const { getBrowserSession } = await flock.import("browser-sessions");
    const accounts = readAgentConnection("whatsapp", id)?.accounts ?? [];
    expect(accounts.length).toBe(1);
    const sessions = (await flock.import("browser-sessions")).listBrowserSessions?.() ?? [];
    const made = sessions.find((s: any) => /^whatsapp-agent-/.test(s.name));
    expect(made && getBrowserSession(made.name)?.state).toBe("ready");
    await tool({ action: "close", windowId: again });
  });

  it("a new code: sign_in in the same window sends nothing; a new window gets a fresh code", async () => {
    dummy.phone.logOutAll();
    const { tool } = owner.chat();
    const a = windowOf((await tool({ action: "open", url: SITE_URL, purpose: "connector" })).text);
    await readUntil(tool, a, /Scan to log in/);
    const asked = dummy.numbersAsked.length;
    await tool({ action: "sign_in", windowId: a, identifier: NUMBER });
    expect(dummy.numbersAsked.length).toBe(asked + 1);
    const again = await tool({ action: "sign_in", windowId: a, identifier: NUMBER });
    expect(again.text).toContain("nothing was sent again");
    expect(dummy.numbersAsked.length).toBe(asked + 1);

    await tool({ action: "close", windowId: a });
    const b = windowOf((await tool({ action: "open", url: SITE_URL, purpose: "connector" })).text);
    await readUntil(tool, b, /Scan to log in/);
    const fresh = await tool({ action: "sign_in", windowId: b, url: SITE_URL, identifier: NUMBER });
    expect(fresh.text).toStartWith("The site asked for a code.");
    expect(dummy.numbersAsked.length).toBe(asked + 2);
    await tool({ action: "close", windowId: b });
  });

  it("QR on request: back to the QR, hand_to_owner lends it, the person scans, signed_in is accepted on that window", async () => {
    dummy.phone.logOutAll();
    const { tool } = owner.chat();
    const w = windowOf((await tool({ action: "open", url: SITE_URL, purpose: "connector" })).text);
    await readUntil(tool, w, /Scan to log in/);
    await tool({ action: "sign_in", windowId: w, identifier: NUMBER });
    await readUntil(tool, w, /Enter code on phone/);

    // The code screen has nothing to type in, so a hand-off lends it as it is (lent-page.ts): the
    // agent goes back to the QR first, as instructions.md says.
    await tool({ action: "act", windowId: w, steps: [{ action: "click", text: "Log in with QR code" }] });
    await readUntil(tool, w, /Scan to log in/);
    const handed = await tool({ action: "hand_to_owner", windowId: w, reason: "Scan the QR code with WhatsApp on your phone (Linked devices > Link a device), wait until your chats appear, then press Done" });
    if (process.env.WA_DEBUG) console.log("[hand_to_owner]", handed.text);
    expect(handed.isError).toBe(false);
    const { lentPageOf, completeHandoff, _testInternals } = await flock.import("agent-browser-handoff");
    const handoffId: string = _testInternals.handoffIds().at(-1) ?? "";
    expect(handoffId).not.toBe("");
    _testInternals.markConnected(handoffId);
    const page = lentPageOf(handoffId);
    await page.waitForFunction('!!document.body && document.body.innerText.includes("Scan to log in")', null, { timeout: 15_000 });
    const device = await page.evaluate('localStorage.getItem("wa-device")');
    dummy.phone.scanQr(device);
    await page.waitForFunction('!!document.body && document.body.innerText.includes("Family")', null, { timeout: 15_000 });
    await completeHandoff(handoffId);

    await readUntil(tool, w, /Family/);
    const recorded = await tool({ action: "signed_in", windowId: w, kind: "handoff" });
    expect(recorded.text).toContain("Recorded");
    await tool({ action: "close", windowId: w });
  });

  it("no request left this machine", () => {
    expect(aborted.filter((u) => new URL(u).host !== "egress-proxy.flock.invalid")).toEqual([]);
  });
});
