import {
  errorJson,
  requireBrowserSession,
  validateId,
  browserInteract,
} from "../../_shared/_google_helpers";

const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
const messageId: string = params.messageId || "";

requireBrowserSession();

if (!messageId) {
  errorJson("MISSING_PARAM", "messageId is required");
}
validateId(messageId, "messageId");

const actions = [
  { action: "wait", delay: 3000 },
  { action: "evaluate", script: `(() => { const btn = document.querySelector('[aria-label="Mark as unread"]') || document.querySelector('[data-tooltip="Mark as unread"]'); if (btn) { btn.click(); return {ok:true,message:'Email marked as unread'}; } return {ok:false,message:'Mark-as-unread button not found. This may only work from within a thread view.'}; })()` },
  { action: "wait", delay: 1000 },
];

(async () => {
  const result = await browserInteract(
    `https://mail.google.com/mail/u/0/#inbox/${messageId}`,
    actions,
  );
  const content = result?.content || "{}";
  const parsed = typeof content === "string" ? JSON.parse(content) : content;
  console.log(JSON.stringify(parsed));
})();
