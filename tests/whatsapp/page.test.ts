// WhatsApp skill: the in-page scripts and page actions (_page.ts), run in Chromium on saved pages.
//
// fixtures/logged-out-*.html are web.whatsapp.com's own log-in screens, saved on 2026-11-25 (scripts,
// styles and the QR data taken out). fixtures/app.html, use-here.html and loading.html are STAND-INS,
// hand-made with made-up data and the markup the scripts expect: the signed-in screens cannot be
// saved without linking a real account, so a run on a linked account is what confirms them.
// Page actions run as Flock runs them: real clicks and keys from Playwright, the page script only marks.
//
// Run: FLOCK_APP_DIR=<flock>/flock-app bun test tests/whatsapp (the scripts import Flock's shared
// helpers and the browser is its playwright-core; see ../grocery/_flock.ts).
import { describe, expect, it, beforeAll, afterAll, setDefaultTimeout } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { canBrowse, hasShared, playwrightPath, sayWhySkipped } from "../grocery/_flock";

type Page = typeof import("../../skills/whatsapp/scripts/_page");
type Action = Record<string, any>;

sayWhySkipped();
const P = (hasShared ? await import("../../skills/whatsapp/scripts/_page") : {}) as Page;
const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
const itShared = hasShared ? it : it.skip;
const itBrowse = canBrowse ? it : it.skip;
setDefaultTimeout(30_000);

let browser: any;
let page: any;

beforeAll(async () => {
  if (!canBrowse) return;
  const { chromium } = await import(playwrightPath);
  browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }));
  page = await browser.newPage();
});
afterAll(async () => { await browser?.close(); });

async function load(name: string): Promise<void> {
  await page.setContent(fixture(name), { waitUntil: "load" });
}

/** Flock's page actions, as real input, then the trailing script's answer. */
async function step<T = any>(actions: Action[], script: string): Promise<T> {
  for (const a of actions) {
    if (a.action === "click") {
      if (a.optional && !(await page.$(a.selector))) continue;
      await page.click(a.selector, { timeout: 2000 });
    } else if (a.action === "insertText") await page.keyboard.insertText(a.text);
    else if (a.action === "press") await page.keyboard.press(a.key);
    else if (a.action === "wait") await page.waitForTimeout(Math.min(a.delay ?? 0, 50));
    else throw new Error(`no stand-in for page action ${a.action}`);
  }
  return P.parse<T>(await page.evaluate(script)) as T;
}

describe("the page scripts as the page gets them", () => {
  itShared("compile, and are read-only (no click, focus, submit or key event)", () => {
    const scripts = [P.SCREEN_PROBE_JS, P.MARK_SEARCH_JS, P.chatListScript(5), P.findRowScript("a'b\"c"), P.searchResultsScript(5, "x"),
      P.readChatScript(5), P.markComposeScript("x"), P.markSendScript("line 1\nline `2` \\ ${3}"), P.verifySentScript("x")];
    for (const s of scripts) {
      expect(() => new Function(`return ${s};`)).not.toThrow();
      expect(s).not.toMatch(/\.click\(|\.focus\(|\.submit\(|dispatchEvent|new (Mouse|Keyboard|Input)Event/);
    }
  });

  itShared("type a message line by line with Shift+Enter between, never a plain Enter", () => {
    const actions = P.typeActions("Hi Mom\n\nReaching by 8");
    expect(actions.filter((a) => a.action === "press").map((a) => a.key)).toEqual(["Shift+Enter", "Shift+Enter"]);
    expect(actions.filter((a) => a.action === "insertText").map((a) => a.text)).toEqual(["Hi Mom", "Reaching by 8"]);
  });
});

describe("which screen WhatsApp Web shows", () => {
  itBrowse("the saved QR log-in screen is signed out", async () => {
    await load("logged-out-qr.html");
    expect(await step([], P.SCREEN_PROBE_JS)).toEqual({ screen: "logged_out", detail: "qr" });
  });

  itBrowse("the saved phone-number log-in screen is signed out", async () => {
    await load("logged-out-phone.html");
    expect(await step([], P.SCREEN_PROBE_JS)).toEqual({ screen: "logged_out", detail: "phone" });
  });

  itBrowse("the chats are the chats, even when a message says 'scan to log in'", async () => {
    await load("app.html");
    expect(await step([], P.SCREEN_PROBE_JS)).toEqual({ screen: "chats" });
    await page.evaluate(() => { document.querySelector("#list span[title]")!.parentElement!.insertAdjacentHTML("beforeend", "<span>Scan to log in</span>"); });
    expect(await step([], P.SCREEN_PROBE_JS)).toEqual({ screen: "chats" });
  });

  itBrowse("'Use here' is clicked with a real click, and the chats come back", async () => {
    await load("use-here.html");
    expect(await step([], P.SCREEN_PROBE_JS)).toEqual({ screen: "use_here" });
    expect(await step(P.useHereActions(), P.SCREEN_PROBE_JS)).toEqual({ screen: "chats" });
  });

  itBrowse("still loading is loading", async () => {
    await load("loading.html");
    expect((await step([], P.SCREEN_PROBE_JS)).screen).toBe("loading");
  });
});

describe("the chat list", () => {
  itBrowse("reads each chat's name, kind, unread count and time", async () => {
    await load("app.html");
    const { chats } = await step([], P.chatListScript(10));
    expect(chats.map((c: any) => c.name)).toEqual(["Family 🏡", "Mom", "Mommy Bakes", "Announcements"]);
    expect(chats[0]).toEqual({ name: "Family 🏡", kind: "group", unread: 3, lastMessageAt: "10:42", preview: "Priya: Dinner at 8?" });
    expect(chats[1]).toMatchObject({ kind: "person", unread: 0, lastMessageAt: "Yesterday" });
    expect(chats[2]).toMatchObject({ kind: "unknown", unread: 1, lastMessageAt: "23/11/2026" });
    expect((await step([], P.chatListScript(2))).chats.length).toBe(2);
  });

  itBrowse("finds a chat by its exact name only: 'mom' is Mom, never Mommy Bakes", async () => {
    await load("app.html");
    expect(await step([], P.findRowScript("  mom "))).toEqual({ found: true });
    expect(await page.$eval('[data-flock-target="wa-row"] span[title]', (e: any) => e.getAttribute("title"))).toBe("Mom");
    expect(await step([], P.findRowScript("Mo"))).toEqual({ found: false });
    expect(await page.$('[data-flock-target="wa-row"]')).toBeNull();
  });
});

describe("search", () => {
  itBrowse("reads chats and messages by section, leaving out people with no chat", async () => {
    await load("app.html");
    expect(await step([], P.MARK_SEARCH_JS)).toEqual({ found: true });
    const read = await step(P.searchActions("friend"), P.searchResultsScript(10));
    expect(read.sections).toBe(true);
    expect(read.chats.map((c: any) => c.name)).toEqual(["Old Friend"]);
    expect(JSON.stringify(read)).not.toContain("Plumber");
    const msgs = await (async () => { await load("app.html"); await step([], P.MARK_SEARCH_JS); return step(P.searchActions("dinner"), P.searchResultsScript(10)); })();
    expect(msgs.messages).toEqual([{ chat: "Family 🏡", text: "Dinner at 8?", time: "10:42" }]);
  });

  itBrowse("marks a chat from the Chats section only, never a contact", async () => {
    await load("app.html");
    await step([], P.MARK_SEARCH_JS);
    expect((await step(P.searchActions("Old Friendly Plumber"), P.searchResultsScript(5, "Old Friendly Plumber"))).found).toBe(false);
    await load("app.html");
    await step([], P.MARK_SEARCH_JS);
    expect((await step(P.searchActions("old friend"), P.searchResultsScript(5, "old friend"))).found).toBe(true);
  });
});

describe("reading a chat", () => {
  itBrowse("reads sender, time and text oldest first, with media as a placeholder", async () => {
    await load("app.html");
    await step([], P.findRowScript("Family 🏡"));
    const read = await step(P.openRowActions(), P.readChatScript(30));
    expect(read.chat).toBe("Family 🏡");
    expect(read.messages).toEqual([
      { from: "Priya", time: "10:30, 25/11/2026", text: "Who is coming tonight?", mine: false },
      { from: "You", time: "10:35, 25/11/2026", text: "Me! 🎉", mine: true },
      { from: "Rahul", time: "10:40, 25/11/2026", text: "The cake", mine: false },
      { from: "Rahul", time: "10:41", text: "[voice message]", mine: false },
      { from: "Priya", time: "10:42, 25/11/2026", text: "Dinner at 8?", mine: false },
    ]);
    expect((await step([], P.readChatScript(2))).messages.map((m: any) => m.text)).toEqual(["[voice message]", "Dinner at 8?"]);
  });
});

describe("sending", () => {
  async function openMom(): Promise<void> {
    await load("app.html");
    await step([], P.findRowScript("Mom"));
    await step(P.openRowActions(), P.readChatScript(1));
  }

  itBrowse("types into the open chat's box, checks it, sends with a real click and sees it in the chat", async () => {
    await openMom();
    expect(await step([], P.markComposeScript("Mom"))).toEqual({ chat: "Mom", found: true });
    const text = "Reaching by 8 🎉\nKeep dinner warm";
    expect(await step(P.typeActions(text), P.markSendScript(text))).toEqual({ typed: true, found: true });
    expect(await page.evaluate("document.body.dataset.sent")).toBeUndefined();
    expect(await step(P.sendActions(), P.verifySentScript(text))).toEqual({ sent: true, pending: false, boxEmpty: true });
    const sent = JSON.parse(await page.evaluate("document.body.dataset.sent"));
    expect(sent.length).toBe(1);
    expect(sent[0].chat).toBe("Mom");
    expect(sent[0].text.replace(/\s+/g, " ")).toBe("Reaching by 8 🎉 Keep dinner warm");
  });

  itBrowse("marks no box when the open chat is not the one asked for", async () => {
    await openMom();
    expect(await step([], P.markComposeScript("Mommy Bakes"))).toEqual({ chat: "Mom", found: false });
  });

  itBrowse("marks no Send button when the box does not hold the message as written", async () => {
    await openMom();
    await step([], P.markComposeScript("Mom"));
    expect(await step(P.typeActions("hello"), P.markSendScript("hello there"))).toEqual({ typed: false, found: false });
  });

  itBrowse("a chat where only admins can send has no box", async () => {
    await load("app.html");
    await step([], P.findRowScript("Announcements"));
    await step(P.openRowActions(), P.readChatScript(1));
    expect(await step([], P.markComposeScript("Announcements"))).toEqual({ chat: "Announcements", found: false });
  });

  itBrowse("a message still on its way is sent and pending", async () => {
    await openMom();
    await page.evaluate("document.body.dataset.slow = '1'");
    await step([], P.markComposeScript("Mom"));
    await step(P.typeActions("ok"), P.markSendScript("ok"));
    expect(await step(P.sendActions(), P.verifySentScript("ok"))).toEqual({ sent: true, pending: true, boxEmpty: true });
  });
});
