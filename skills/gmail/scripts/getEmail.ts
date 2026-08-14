import {
  errorJson,
  requireBrowserSession,
  validateId,
  browserWrite,
} from "../../_shared/_google_helpers";

const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
const messageId: string = params.messageId || "";

requireBrowserSession();

if (!messageId) {
  errorJson("MISSING_PARAM", "messageId is required");
}
validateId(messageId, "messageId");

const evalScript = `(() => {
  const subject = document.querySelector('h2.hP')?.textContent?.trim() || '';
  const senders = Array.from(document.querySelectorAll('.gD')).map(s => ({
    name: s.textContent?.trim() || '',
    email: s.getAttribute('email') || ''
  }));
  const dates = Array.from(document.querySelectorAll('.g3')).map(d => d.textContent?.trim() || '');
  const messages = Array.from(document.querySelectorAll('.a3s.aiL')).map(b => b.textContent?.trim() || '');
  const from = senders.length > 0
    ? (senders[0].name ? senders[0].name + ' <' + senders[0].email + '>' : senders[0].email)
    : '';
  const body = messages.join('\\n---\\n');
  return JSON.stringify({
    subject,
    from,
    date: dates[0] || '',
    body: body || '',
    snippet: (body || '').substring(0, 200),
    senders,
    messageCount: messages.length
  });
})()`;

(async () => {
  const result = await browserWrite(
    `https://mail.google.com/mail/u/0/#inbox/${messageId}`,
    evalScript,
    ".a3s.aiL",
  );
  const content = result?.content || "{}";
  const parsed = typeof content === "string" ? JSON.parse(content) : content;
  console.log(JSON.stringify({ ...parsed, id: messageId }));
})();
