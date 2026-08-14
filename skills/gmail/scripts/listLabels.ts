import {
  requireBrowserSession,
  browserWrite,
} from "../../_shared/_google_helpers";

requireBrowserSession();

const evalScript = `(() => {
  const labels = [];
  document.querySelectorAll('.aim .TO a').forEach(a => {
    const name = a.textContent?.trim();
    if (!name) return;
    const count = a.closest('.aim')?.querySelector('.bsU')?.textContent?.trim() || '0';
    labels.push({ id: name, name: name, type: 'user', unreadCount: parseInt(count) || 0 });
  });
  const systemLabels = ['INBOX', 'STARRED', 'SNOOZED', 'SENT', 'DRAFTS', 'IMPORTANT', 'SPAM', 'TRASH'];
  systemLabels.forEach(l => {
    const existing = labels.find(lb => lb.name.toUpperCase() === l);
    if (existing) existing.type = 'system';
  });
  return JSON.stringify({ labels });
})()`;

(async () => {
  const result = await browserWrite(
    "https://mail.google.com/mail/u/0/#inbox",
    evalScript,
    ".aim",
  );
  const content = result?.content || "{}";
  const parsed = typeof content === "string" ? JSON.parse(content) : content;
  console.log(JSON.stringify(parsed));
})();
