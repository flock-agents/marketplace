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
  { action: "evaluate", script: `(() => { const star = document.querySelector('.T-KT[aria-label*="Not starred"]') || document.querySelector('[data-tooltip*="Not starred"]'); if (star) { star.click(); return {ok:true,message:'Message starred'}; } const alreadyStarred = document.querySelector('.T-KT-Jp[aria-label*="Starred"]'); if (alreadyStarred) { return {ok:true,message:'Message already starred'}; } return {ok:false,message:'Star button not found'}; })()` },
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
