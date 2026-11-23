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
  ...markThenClick("star", `(() => { const star = document.querySelector('.T-KT[aria-label*="Not starred"]') || document.querySelector('[data-tooltip*="Not starred"]'); if (star) { mark(star, "star"); return {ok:true,message:'Message starred'}; } const alreadyStarred = document.querySelector('.T-KT-Jp[aria-label*="Starred"]'); if (alreadyStarred) { return {ok:true,message:'Message already starred'}; } return {ok:false,message:'Star button not found'}; })()`),
  { action: "wait", delay: 1000 },
];

(async () => {
  const result = await browserInteract(
    `https://mail.google.com/mail/u/0/#inbox/${messageId}`,
    actions,
  );
  const content = result?.content || "{}";
  const parsed = typeof content === "string" ? JSON.parse(content) : content;
  // Starring changed the thread's state; drop any cached copy so the next read reflects it. Swallowed.
  invalidateCachedThreadForMessage(messageId, "starMessage");
  console.log(JSON.stringify(parsed));
})();
