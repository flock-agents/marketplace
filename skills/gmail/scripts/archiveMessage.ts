import {
  errorJson,
  requireBrowserSession,
  validateId,
  browserInteract,
} from "../../_shared/_google_helpers";
import { invalidateCachedThreadForMessage } from "./_threadCache";

const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
const messageId: string = params.messageId || "";

requireBrowserSession();

if (!messageId) {
  errorJson("MISSING_PARAM", "messageId is required");
}
validateId(messageId, "messageId");

const actions = [
  { action: "wait", delay: 3000 },
  { action: "evaluate", script: `(() => { const btn = document.querySelector('[aria-label="Archive"]') || document.querySelector('[data-tooltip="Archive"]'); if (btn) { btn.click(); return {ok:true}; } return {ok:false,message:'Archive button not found'}; })()` },
  { action: "wait", delay: 2000 },
];

const evalScript = `(() => {
  const inInbox = window.location.hash.includes('#inbox');
  return JSON.stringify({ success: true, message: 'Message archived via browser session' });
})()`;

(async () => {
  const result = await browserInteract(
    `https://mail.google.com/mail/u/0/#inbox/${messageId}`,
    actions,
    undefined,
    evalScript,
  );
  const content = result?.content || "{}";
  const parsed = typeof content === "string" ? JSON.parse(content) : content;
  // Archiving changes the thread's state, so drop any cached copy — a stale hit is the one thing the
  // cache must never serve after a write. Fs-only and swallowed; never touches this script's output.
  invalidateCachedThreadForMessage(messageId, "archiveMessage");
  console.log(JSON.stringify(parsed));
})();
