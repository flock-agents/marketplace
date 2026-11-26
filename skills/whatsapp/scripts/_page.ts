/**
 * WhatsApp Web: the page scripts and page actions. PURE: no network, no files (the function scripts
 * do that), so what is worth a test lives here.
 *
 * Page scripts only READ the page and MARK elements (Flock's `_shared/_realInput.ts`); every click
 * and keystroke is a page action Flock performs with real input.
 *
 * Selectors: the logged-out screens (QR code, phone number) were read from web.whatsapp.com on
 * 2026-11-25 (tests/whatsapp/fixtures). The logged-in screens (chat list, an open chat, search,
 * the composer, "Use here") could not be read without a linked account: their selectors follow
 * WhatsApp Web's long-standing markup (`#pane-side`, `#main`, `data-id`, `data-pre-plain-text`,
 * `span[title]`, the footer's contenteditable) with fallbacks, and every reader fails safe: nothing
 * found is an empty read or a refusal, never a guess, and a send only goes out when the open chat's
 * own header names the chat asked for.
 */
import { MARK_JS, clickTarget } from "../../_shared/_realInput";

export const WHATSAPP_URL = "https://web.whatsapp.com/";

export const MARK = {
  useHere: "wa-use-here",
  row: "wa-row",
  search: "wa-search",
  compose: "wa-compose",
  send: "wa-send",
} as const;

/** What a screen probe sees. */
export type Screen = "chats" | "logged_out" | "use_here" | "loading";
export interface ScreenProbe { screen: Screen; detail?: string }

/** Shared page-side helpers: the marks, text normalising, the chat-list rows and their names. */
const PAGE_HELPERS = String.raw`${MARK_JS}
  var norm = function(s) { return String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim(); };
  var key = function(s) { return norm(s).replace(/\uFE0F/g, '').toLowerCase(); };
  var plain = function(el) {
    if (!el) return '';
    var out = '';
    el.childNodes.forEach(function(n) {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeName === 'IMG') out += n.getAttribute('data-plain-text') || n.getAttribute('alt') || '';
      else if (n.nodeName === 'BR') out += ' ';
      else if (n.nodeType === 1) out += plain(n) + (/^(DIV|P)$/.test(n.nodeName) ? ' ' : '');
    });
    return out;
  };
  var visible = function(el) { return !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); };
  var side = function() { return document.querySelector('#pane-side') || document.querySelector('[aria-label="Chat list" i]') || document.querySelector('[data-testid="chat-list"]') || document.querySelector('#side'); };
  var rowsOf = function(root) {
    if (!root) return [];
    var rows = Array.from(root.querySelectorAll('[role="listitem"], [role="row"]'));
    return rows.filter(function(r) { return !rows.some(function(o) { return o !== r && o.contains(r); }); });
  };
  var nameOf = function(row) { var t = row.querySelector('span[title]'); return t ? norm(t.getAttribute('title') || t.innerText) : ''; };
  var TIME = /^(\d{1,2}[:.]\d{2}(\s?[ap]\.?m\.?)?|yesterday|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})$/i;
  var timeOf = function(row, last) {
    var times = Array.from(row.querySelectorAll('div, span')).filter(function(e) { return e.children.length === 0 && TIME.test(norm(e.innerText)); });
    var at = last ? times[times.length - 1] : times[0];
    return at ? norm(at.innerText) : '';
  };
  var unreadOf = function(row) {
    var b = row.querySelector('[aria-label*="unread" i]');
    if (!b) return 0;
    var m = (b.getAttribute('aria-label') || '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 1;
  };
  var kindOf = function(row) {
    if (row.querySelector('[data-icon*="default-group"], [data-icon*="group"]')) return 'group';
    if (row.querySelector('[data-icon*="default-user"], [data-icon*="default-contact"]')) return 'person';
    return 'unknown';
  };
  var previewOf = function(row) {
    var titled = Array.from(row.querySelectorAll('span[title]'));
    return titled.length > 1 ? norm(titled[titled.length - 1].getAttribute('title') || titled[titled.length - 1].innerText) : '';
  };`;

/** Which screen WhatsApp Web shows. "Use here" (WhatsApp open in another window of this same
 *  browser) has its button marked. → JSON ScreenProbe. */
export const SCREEN_PROBE_JS = String.raw`(() => {
  ${PAGE_HELPERS}
  var buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
  var useHere = buttons.find(function(b) { return visible(b) && key(b.innerText) === 'use here'; });
  if (useHere) { flockMark('${MARK.useHere}', useHere); return JSON.stringify({ screen: 'use_here' }); }
  if (side()) return JSON.stringify({ screen: 'chats' });
  var text = norm(document.body ? document.body.innerText : '');
  var phone = document.querySelector('[data-testid="phone-number-input"]');
  var loggedOut = phone || document.querySelector('[data-testid^="link_device_"], [data-testid^="link-device-"], canvas[aria-label*="QR code" i]')
    || /scan to log in|enter phone number|enter code on phone|log in with phone number|steps to log in/i.test(text);
  if (loggedOut) return JSON.stringify({ screen: 'logged_out', detail: /enter code on phone/i.test(text) ? 'code' : (phone ? 'phone' : 'qr') });
  return JSON.stringify({ screen: 'loading', detail: text.slice(0, 80) });
})()`;

/** The "Use here" click, and a moment for the chats to come back. */
export function useHereActions(): any[] {
  return [clickTarget(MARK.useHere), { action: "wait", delay: 4000 }];
}

export interface ChatRow { name: string; kind: "group" | "person" | "unknown"; unread: number; lastMessageAt: string; preview: string }

/** The chat list as shown, newest first, at most `max` rows. → JSON { chats: ChatRow[] }. */
export function chatListScript(max: number): string {
  return String.raw`(() => {
  ${PAGE_HELPERS}
  var rows = rowsOf(side()).filter(function(r) { return nameOf(r); }).slice(0, ${Math.trunc(max)});
  return JSON.stringify({ chats: rows.map(function(r) { return { name: nameOf(r), kind: kindOf(r), unread: unreadOf(r), lastMessageAt: timeOf(r), preview: previewOf(r).slice(0, 120) }; }) });
})()`;
}

/** Marks the chat-list row named exactly `name` (case and spacing aside). → JSON { found }. */
export function findRowScript(name: string): string {
  return String.raw`(() => {
  ${PAGE_HELPERS}
  var want = key(${JSON.stringify(name)});
  var row = rowsOf(side()).find(function(r) { return key(nameOf(r)) === want; }) || null;
  return JSON.stringify({ found: flockMark('${MARK.row}', row) });
})()`;
}

/** Marks the search box. → JSON { found }. */
export const MARK_SEARCH_JS = String.raw`(() => {
  ${PAGE_HELPERS}
  var box = document.querySelector('#side [contenteditable="true"][role="textbox"]')
    || document.querySelector('[aria-label="Search input textbox" i]')
    || document.querySelector('#side input[type="text"], input[aria-label*="Search" i]')
    || document.querySelector('[contenteditable="true"][data-tab="3"]');
  return JSON.stringify({ found: flockMark('${MARK.search}', visible(box) ? box : null) });
})()`;

/** Types `query` into the marked search box and lets the results come. */
export function searchActions(query: string): any[] {
  return [clickTarget(MARK.search), { action: "wait", delay: 400 }, { action: "insertText", text: query }, { action: "wait", delay: 2500 }];
}

export interface SearchRead { sections: boolean; chats: ChatRow[]; messages: { chat: string; text: string; time: string }[] }

/** WhatsApp Web's search results, by section: "Chats" (and "Groups") are chats already in the chat
 *  list, "Messages" are messages; "Contacts" are people with no chat yet and are left out. With
 *  `markChat`, the row in the Chats section named exactly that is marked. → JSON SearchRead & { found? }. */
export function searchResultsScript(max: number, markChat = ""): string {
  return String.raw`(() => {
  ${PAGE_HELPERS}
  var want = key(${JSON.stringify(markChat)});
  var root = side();
  var ROW = '[role="listitem"], [role="row"]';
  var SECTION = /^(chats|groups|contacts|messages|groups in common)$/i;
  var section = '', sections = false, chats = [], messages = [], target = null;
  var all = root ? Array.from(root.querySelectorAll('*')) : [];
  for (var i = 0; i < all.length; i++) {
    var n = all[i];
    var outer = n.parentElement ? n.parentElement.closest(ROW) : null;
    if (n.matches(ROW) && !(outer && root.contains(outer))) {
      var name = nameOf(n);
      if (!name) continue;
      if (section === 'chats' || section === 'groups') {
        if (chats.length < ${Math.trunc(max)}) chats.push({ name: name, kind: section === 'groups' ? 'group' : kindOf(n), unread: unreadOf(n), lastMessageAt: timeOf(n), preview: previewOf(n).slice(0, 120) });
        if (want && !target && key(name) === want) target = n;
      } else if (section === 'messages' && messages.length < ${Math.trunc(max)}) {
        messages.push({ chat: name, text: previewOf(n).slice(0, 300), time: timeOf(n) });
      }
      continue;
    }
    if (n.closest(ROW) || n.children.length > 0) continue;
    var label = norm(n.innerText);
    if (SECTION.test(label)) { section = label.toLowerCase(); sections = true; }
  }
  var out = { sections: sections, chats: chats, messages: messages };
  if (want) out.found = flockMark('${MARK.row}', target);
  return JSON.stringify(out);
})()`;
}

/** A real click on the marked chat row, and a moment for the chat to open. */
export function openRowActions(): any[] {
  return [clickTarget(MARK.row), { action: "wait", delay: 2500 }];
}

export interface Message { from: string; time: string; text: string; mine: boolean }
export interface ChatRead { chat: string; messages: Message[] }

/** The open chat's header name and its last `count` messages, oldest first. A message with no text
 *  is a short placeholder ("[photo]", "[voice message]", …). → JSON ChatRead. */
export function readChatScript(count: number): string {
  return String.raw`(() => {
  ${PAGE_HELPERS}
  var main = document.querySelector('#main');
  if (!main) return JSON.stringify({ chat: '', messages: [] });
  var head = main.querySelector('header span[title], header [title]');
  var chat = head ? norm(head.getAttribute('title') || head.innerText) : '';
  var PRE = /^\[([^\]]+)\]\s*(.*?):\s*$/;
  var placeholder = function(m) {
    if (m.querySelector('[data-icon*="audio"], [data-icon*="ptt"], audio')) return '[voice message]';
    if (m.querySelector('video, [data-icon*="media-play"], [data-icon*="video"]')) return '[video]';
    if (m.querySelector('[data-icon*="document"], [data-icon^="doc-"]')) return '[document]';
    if (m.querySelector('[data-icon*="sticker"]') || m.querySelector('img[alt*="sticker" i]')) return '[sticker]';
    if (m.querySelector('[data-icon*="location"]')) return '[location]';
    if (m.querySelector('[data-icon*="vcard"], [data-icon*="contact"]')) return '[contact card]';
    if (m.querySelector('img:not(.emoji):not([data-plain-text])')) return '[photo]';
    return '[message]';
  };
  var rows = Array.from(main.querySelectorAll('[data-id]')).filter(function(m) { return /^(true|false)_/.test(m.getAttribute('data-id') || ''); });
  rows = rows.filter(function(m) { return !rows.some(function(o) { return o !== m && o.contains(m); }); });
  var lastFrom = '';
  var out = rows.map(function(m) {
    var mine = /^true_/.test(m.getAttribute('data-id'));
    var preEl = m.querySelector('[data-pre-plain-text]');
    var pre = preEl ? (preEl.getAttribute('data-pre-plain-text') || '').match(PRE) : null;
    var body = m.querySelector('.selectable-text, [data-testid="msg-text"]');
    var text = body ? norm(plain(body)) : '';
    var caption = text;
    var media = placeholder(m);
    if (!text) text = media; else if (media !== '[message]' && media !== '[photo]' && m.querySelector('img:not(.emoji):not([data-plain-text]), video')) text = media + ' ' + caption;
    var from = mine ? 'You' : (pre ? norm(pre[2]) : '') || lastFrom || chat;
    if (!mine) lastFrom = from;
    var time = pre ? norm(pre[1]) : timeOf(m, true);
    return { from: from, time: time, text: text.slice(0, 2000), mine: mine };
  });
  return JSON.stringify({ chat: chat, messages: out.slice(-${Math.trunc(count)}) });
})()`;
}

/** Marks the open chat's message box, when the open chat is `name`. → JSON { chat, found }. */
export function markComposeScript(name: string): string {
  return String.raw`(() => {
  ${PAGE_HELPERS}
  var main = document.querySelector('#main');
  var head = main ? main.querySelector('header span[title], header [title]') : null;
  var chat = head ? norm(head.getAttribute('title') || head.innerText) : '';
  var box = main ? main.querySelector('footer [contenteditable="true"][role="textbox"], footer [contenteditable="true"]') : null;
  var right = key(chat) === key(${JSON.stringify(name)});
  return JSON.stringify({ chat: chat, found: flockMark('${MARK.compose}', right && visible(box) ? box : null) });
})()`;
}

/** Types the message into the marked box: one line at a time, Shift+Enter between lines (a plain
 *  Enter would send half of it). */
export function typeActions(text: string): any[] {
  const lines = text.split(/\r?\n/);
  const typed = lines.flatMap((line, i) => [
    ...(i > 0 ? [{ action: "press", key: "Shift+Enter" }] : []),
    ...(line ? [{ action: "insertText", text: line }] : []),
  ]);
  return [clickTarget(MARK.compose), { action: "wait", delay: 300 }, ...typed, { action: "wait", delay: 600 }];
}

/** After typing: marks the Send button when the box holds the message. → JSON { typed, found }. */
export function markSendScript(text: string): string {
  return String.raw`(() => {
  ${PAGE_HELPERS}
  var main = document.querySelector('#main');
  var box = main ? main.querySelector('footer [contenteditable="true"]') : null;
  var want = key(${JSON.stringify(text)});
  var typed = !!box && key(plain(box)) === want;
  var icon = main ? main.querySelector('footer [data-icon="send"], footer [data-icon*="send"]') : null;
  var btn = (main && main.querySelector('footer button[aria-label="Send" i], footer [role="button"][aria-label="Send" i]')) || (icon && icon.closest('button, [role="button"]')) || null;
  return JSON.stringify({ typed: typed, found: flockMark('${MARK.send}', typed && visible(btn) ? btn : null) });
})()`;
}

/** The marked Send button, clicked, and a moment for the message to leave. */
export function sendActions(): any[] {
  return [clickTarget(MARK.send), { action: "wait", delay: 2500 }];
}

/** After the send: is the message the chat's last own message, and is the box empty?
 *  → JSON { sent: true | null, pending, boxEmpty }. */
export function verifySentScript(text: string): string {
  return String.raw`(() => {
  ${PAGE_HELPERS}
  var main = document.querySelector('#main');
  if (!main) return JSON.stringify({ sent: null, pending: false, boxEmpty: false });
  var box = main.querySelector('footer [contenteditable="true"]');
  var boxEmpty = !box || norm(plain(box)) === '';
  var mine = Array.from(main.querySelectorAll('[data-id^="true_"]'));
  var last = mine[mine.length - 1];
  var want = key(${JSON.stringify(text)});
  var shown = !!last && key(plain(last)).indexOf(want.slice(0, 60)) >= 0;
  var pending = !!last && !!last.querySelector('[data-icon*="msg-time"], [data-icon*="clock"]');
  return JSON.stringify({ sent: shown && boxEmpty ? true : null, pending: pending, boxEmpty: boxEmpty });
})()`;
}

export function parse<T>(content: unknown): T | null {
  if (content && typeof content === "object") return content as T;
  try { return JSON.parse(String(content ?? "")) as T; } catch { return null; }
}
