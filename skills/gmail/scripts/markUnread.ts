import {
  errorJson,
  requireBrowserSession,
  validateId,
  browserInteract,
} from "../../_shared/_google_helpers";
import { invalidateCachedThreadForMessage } from "./_threadCache";
import { markThenClick } from "./_gmailPress";

const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
const messageId: string = params.messageId || "";

requireBrowserSession();

if (!messageId) {
  errorJson("MISSING_PARAM", "messageId is required");
}
validateId(messageId, "messageId");

const actions = [
  { action: "wait", delay: 3000 },
  ...markThenClick("mark-unread", `(() => { const btn = document.querySelector('[aria-label="Mark as unread"]') || document.querySelector('[data-tooltip="Mark as unread"]'); if (btn) { mark(btn, "mark-unread"); return {ok:true,message:'Email marked as unread'}; } return {ok:false,message:'Mark-as-unread button not found. This may only work from within a thread view.'}; })()`),
  { action: "wait", delay: 1000 },
];

(async () => {
  const result = await browserInteract(
    `https://mail.google.com/mail/u/0/#inbox/${messageId}`,
    actions,
  );
  const content = result?.content || "{}";
  const parsed = typeof content === "string" ? JSON.parse(content) : content;
  // The read/unread flag changed; drop any cached copy so the next read reflects it. Swallowed fs-only.
  invalidateCachedThreadForMessage(messageId, "markUnread");
  console.log(JSON.stringify(parsed));
})();
