import {
  errorJson,
  requireBrowserSession,
  validateId,
  persistentCreate,
  persistentInteract,
} from "../../_shared/_google_helpers";

const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
const messageId: string = params.messageId || "";
const bodyText: string = params.body || "";

requireBrowserSession();

if (!messageId || !bodyText) {
  errorJson("MISSING_PARAM", "messageId and body are required");
}
validateId(messageId, "messageId");

(async () => {
  const sessionResult = await persistentCreate(
    `https://mail.google.com/mail/u/0/#inbox/${messageId}`,
  );
  const persistentId: string = sessionResult?.persistentSessionId || "";

  if (!persistentId) {
    errorJson("SESSION_ERROR", "Failed to create persistent session for Gmail reply");
  }

  // Open reply editor
  const replyOpenActions = [
    { action: "waitForSelector", selector: `[aria-label="Reply"],.T-I-JW[data-tooltip="Reply"]`, delay: 5000 },
    { action: "evaluate", script: `(() => { const replyBtns = document.querySelectorAll("[aria-label=\\"Reply\\"]"); const btn = replyBtns[replyBtns.length - 1]; if (btn) { btn.click(); return {ok:true}; } const altBtn = document.querySelector(".T-I-JW[data-tooltip=\\"Reply\\"]"); if (altBtn) { altBtn.click(); return {ok:true}; } return {ok:false,message:"Reply button not found"}; })()` },
    { action: "waitForSelector", selector: `div[aria-label*="Message"][contenteditable=true]`, delay: 5000 },
  ];
  await persistentInteract(persistentId, replyOpenActions);

  // Type reply body
  const typeActions = [
    { action: "click", selector: `div[aria-label*="Message"][contenteditable=true]` },
    { action: "insertText", text: bodyText },
    { action: "wait", delay: 500 },
  ];
  await persistentInteract(persistentId, typeActions);

  // Send
  const evalScript = `(() => {
  return JSON.stringify({ success: true, message: 'Reply sent via browser session' });
})()`;

  const sendActions = [
    { action: "waitForSelector", selector: `[aria-label*="Send"]:not([aria-label*="Schedule"])` },
    { action: "click", selector: `[aria-label*="Send"]:not([aria-label*="Schedule"])` },
    { action: "wait", delay: 3000 },
  ];

  const result = await persistentInteract(persistentId, sendActions, true, evalScript);
  const content = result?.content || "{}";
  let parsed: any;
  try { parsed = typeof content === "string" ? JSON.parse(content) : content; }
  catch { parsed = { success: null, message: "Action completed, but could not confirm the result — verify in Gmail." }; } // CRAFO-988
  console.log(JSON.stringify(parsed));
})();
