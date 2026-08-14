#!/bin/bash
set -euo pipefail

if [ -z "${BROWSER_SESSION:-}" ] && [ -n "${SECRET_IMAP_CREDENTIALS:-}" ]; then
  exec python3 "$(dirname "$0")/gmail-imap.py"
fi
source "$(dirname "$0")/_gmail_helpers.sh"

_require_browser_session

EVAL_SCRIPT="(() => {
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
})()"

RESULT=$(_browser_write "https://mail.google.com/mail/u/0/#inbox" "$EVAL_SCRIPT" ".aim")
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')
echo "$CONTENT" | jq -c '.'
