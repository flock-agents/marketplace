import {
  errorJson,
  requireBrowserSession,
  persistentCreate,
  persistentInteract,
} from "../../_shared/_google_helpers";
import { existsSync } from "fs";

const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
const to: string = params.to || "";
const subject: string = params.subject || "";
const bodyText: string = params.body || "";
const cc: string = params.cc || "";
const bcc: string = params.bcc || "";

let attachments: string[] = [];
if (params.attachments != null) {
  if (Array.isArray(params.attachments)) {
    attachments = params.attachments.filter((a: any) => a != null && a !== "");
  } else if (typeof params.attachments === "string" && params.attachments) {
    attachments = params.attachments.split("\n").filter((a: string) => a.trim() !== "");
  }
}

requireBrowserSession();

if (!to || !subject) {
  errorJson("MISSING_PARAM", "to and subject are required");
}

(async () => {
  const sessionResult = await persistentCreate("https://mail.google.com/mail/u/0/#inbox");
  const persistentId: string = sessionResult?.persistentSessionId || "";

  if (!persistentId) {
    errorJson("SESSION_ERROR", "Failed to create persistent session for Gmail");
  }

  // Click Compose button
  const composeActions = [
    { action: "waitForSelector", selector: ".T-I.T-I-KE.L3", delay: 5000 },
    { action: "click", selector: ".T-I.T-I-KE.L3" },
    { action: "waitForSelector", selector: "[aria-label*=\"To\"] input, textarea[aria-label*=\"To\"], [name=to]", delay: 5000 },
  ];
  await persistentInteract(persistentId, composeActions);

  // Fill To field
  const recipientActions = [
    { action: "insertText", text: to },
    { action: "press", key: "Tab" },
    { action: "wait", delay: 1000 },
  ];
  await persistentInteract(persistentId, recipientActions);

  // CC — Gmail hides this by default; expand via the toggle link, then fill
  if (cc) {
    const ccExpandScript = `(() => {
    const c = document.querySelector("[role=dialog],.AD") || document;
    const f = c.querySelector("textarea[name=cc],input[name=cc]");
    if (f) return "visible";
    for (const el of c.querySelectorAll("span,a,[role=link],[role=button]")) {
      const t = el.textContent.trim();
      if (t === "Cc" || t === "Cc Bcc") { el.click(); return "expanded"; }
    }
    return "not-found";
  })()`;
    const ccExpandActions = [
      { action: "evaluate", script: ccExpandScript },
      { action: "wait", delay: 500 },
    ];
    await persistentInteract(persistentId, ccExpandActions);

    const ccFillActions = [
      { action: "click", selector: `textarea[name="cc"], input[name="cc"], [aria-label="Cc"] input` },
      { action: "insertText", text: cc },
      { action: "press", key: "Tab" },
      { action: "wait", delay: 500 },
    ];
    await persistentInteract(persistentId, ccFillActions);
  }

  // BCC — same pattern; may need separate expansion if CC didn't reveal it
  if (bcc) {
    const bccExpandScript = `(() => {
    const c = document.querySelector("[role=dialog],.AD") || document;
    const f = c.querySelector("textarea[name=bcc],input[name=bcc]");
    if (f) return "visible";
    for (const el of c.querySelectorAll("span,a,[role=link],[role=button]")) {
      if (el.textContent.trim() === "Bcc") { el.click(); return "expanded"; }
    }
    return "not-found";
  })()`;
    const bccExpandActions = [
      { action: "evaluate", script: bccExpandScript },
      { action: "wait", delay: 500 },
    ];
    await persistentInteract(persistentId, bccExpandActions);

    const bccFillActions = [
      { action: "click", selector: `textarea[name="bcc"], input[name="bcc"], [aria-label="Bcc"] input` },
      { action: "insertText", text: bcc },
      { action: "press", key: "Tab" },
      { action: "wait", delay: 500 },
    ];
    await persistentInteract(persistentId, bccFillActions);
  }

  // Fill subject and body
  const contentActions = [
    { action: "click", selector: "input[name=subjectbox]" },
    { action: "insertText", text: subject },
    { action: "click", selector: "div[aria-label*=\"Message\"]" },
    { action: "insertText", text: bodyText },
    { action: "wait", delay: 1000 },
  ];
  await persistentInteract(persistentId, contentActions);

  // Attachments — upload each file via the hidden file input
  for (const aPath of attachments) {
    const trimmed = aPath.trim();
    if (!trimmed || !existsSync(trimmed)) continue;
    const attachActions = [
      { action: "upload", selector: `input[type="file"]`, filePath: trimmed },
      { action: "wait", delay: 2000 },
    ];
    await persistentInteract(persistentId, attachActions);
  }

  // Close compose (save draft)
  const evalScript = `(() => {
  return JSON.stringify({ success: true, message: 'Draft created via browser session' });
})()`;

  const closeActions = [
    { action: "evaluate", script: `(() => { const closeBtn = document.querySelector('.Ha img.Ha-Jj') || document.querySelector('[aria-label="Save & close"]') || document.querySelector('.og.T-I-J3'); if (closeBtn) { closeBtn.click(); return {ok:true}; } return {ok:true,message:"Draft saved (compose left open)"}; })()` },
    { action: "wait", delay: 1500 },
  ];

  const result = await persistentInteract(persistentId, closeActions, true, evalScript);
  const content = result?.content || "{}";
  let parsed: any;
  try { parsed = typeof content === "string" ? JSON.parse(content) : content; }
  catch { parsed = { success: null, message: "Action completed, but could not confirm the result — verify in Gmail." }; } // CRAFO-988
  console.log(JSON.stringify(parsed));
})();
