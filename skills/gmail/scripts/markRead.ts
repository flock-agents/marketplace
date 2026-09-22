import {
  errorJson,
  requireBrowserSession,
  validateId,
  browserWrite,
} from "../../_shared/_google_helpers";
import { invalidateCachedThreadForMessage } from "./_threadCache";

const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
const messageId: string = params.messageId || "";

requireBrowserSession();

if (!messageId) {
  errorJson("MISSING_PARAM", "messageId is required");
}
validateId(messageId, "messageId");

const evalScript = `(() => {
  const subject = document.querySelector('h2.hP')?.textContent?.trim() || '';
  return JSON.stringify({ ok: true, message: 'Email opened (marked as read)', subject });
})()`;

(async () => {
  const result = await browserWrite(
    `https://mail.google.com/mail/u/0/#inbox/${messageId}`,
    evalScript,
    ".a3s.aiL",
  );
  const content = result?.content || "{}";
  const parsed = typeof content === "string" ? JSON.parse(content) : content;
  // The read/unread flag changed; drop any cached copy so the next read reflects it. Swallowed fs-only.
  invalidateCachedThreadForMessage(messageId, "markRead");
  console.log(JSON.stringify(parsed));
})();
