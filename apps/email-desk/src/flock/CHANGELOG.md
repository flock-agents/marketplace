# Flock component library — changelog

Written for the Flock Assistant. Each entry says what changed and what an app built on the
previous version must change when the new library reaches it. An untouched app gets the new design
with its next auto-update; a customized app stays as it is until the owner updates it (a branch with
a brief to the paired agent, which applies the notes below).

## 1.10.10 — no chat for a viewer who has no agent in the app
- The app's owner now chooses, in Flock's Share dialog, what the app's agent does for the people it is shared with by e-mail and for anyone with its link: No agent, Agent on app data, or (people only) Full agent access. For a viewer whose kind is on No agent, Flock's proxy adds `X-Flock-App-Chat: off` to the page's `GET ./api/_me`, the kit answers `chat: false` there (`Me.chat` in `data/hooks.ts`), and `AppShell` then shows no chat at all: no side panel, no "Ask <agent>" launcher, no Chat page. Everyone else gets no such field and sees the chat as before.
- An untouched app: nothing to change; it hides the chat once rebuilt on this library. Until then it keeps showing the button, and Flock refuses the message (403, `code: "app_chat_off"`, "This app has no agent for you."). A customized app that kept `AppShell` as shipped: take `AppShell.tsx` and `data/hooks.ts`. One with its own frame (not `AppShell`): read `useMe().chat` and draw no chat when it is `false`.

## 1.10.9 — the phone sheet's colours are theme tokens
- `--sheet-scrim`, `--sheet-card`, `--sheet-line` and `--sheet-shadow` (the phone chat sheet's dim, card, hairline and shadow, light and dark) move from `app-shell.css`'s `.fl-shell-sheet-wrap` into `theme/flock/tokens.css` (`:root` and both dark blocks), so components carry no literal colours. The launcher's white avatar disc reads `--obj-white`. Nothing looks different.
- An untouched app: nothing to change. A customized app that kept `AppShell` as shipped: take `app-shell.css` together with `theme/flock/tokens.css` (the new `app-shell.css` alone leaves the sheet without its colours). One that styled `.fl-shell-sheet` with the `--sheet-*` variables: unchanged.

## 1.10.8 — the owner's Settings & routines page inside every app
- Inside Flock, the signed-in owner gets a last page in `AppShell`'s navigation, "Settings" (`settings-2` icon, id `flock-settings`, exported as `SETTINGS_PAGE`). It shows Flock's own Settings & routines page for the app (`/embed/app-settings?app=<id>&theme=<light|dark>`) in an iframe (`FlockSettingsFrame`, class `.fl-settings-frame`), wearing the app's theme (the address first, then `flock:settings-theme` messages, again after each `flock:settings-ready`). The page is the shell's own: the app's `onNavigate` never hears `flock-settings`, and choosing one of the app's pages hands it back. An app with no pages gets two: its own (named after the app) and Settings.
- Visitors never see it: the page is added only after Flock's auth check says the viewer is its owner (`useFlockOwner`) and the kit names the app, and it goes for the rest of the visit when the embed posts `flock:settings-unavailable`. Messages are taken only from the frame's own window on the app's own origin (`data/flock-settings-bridge.ts`, as `flock-chat-bridge.ts`).
- New optional prop `settings?: { render }` on `AppShell`: draws the app's own page in place of Flock's (rarely wanted).
- The navigation is chosen from the app's own pages: the Settings page never changes it (an app with 4 pages keeps top tabs, now 5 with Settings; one with 5 or more keeps its side rail, Settings last). Its one exception: a navigation that would be none (`nav="none"`, or one page with `nav="auto"`) is drawn as `"top"` with the Settings page on (inside Flock, the owner): two tabs, the app's own page (named after the app) and Settings. For visitors and outside Flock `nav="none"` is unchanged (no tab bar). The embed posts `flock:settings-unavailable` only for "not yours to see" (401/403) or no app named; a server or network failure keeps the tab and the page offers Try again.
- An untouched app: nothing to change; it gets the page once rebuilt on this library. A customized app that kept `AppShell` as shipped: take `AppShell.tsx`, `FlockSettingsFrame.tsx`, `app-shell.css` and `data/flock-settings-bridge.ts`. One with its own frame (not `AppShell`): add a page that frames `/embed/app-settings?app=<appId>` for the owner and removes it on `flock:settings-unavailable`.

## 1.10.7 — Flock can open the app's chat at load
- `data/flock-host.ts`: `CHAT_PARAM` (`flock_chat`) and `flockAsksChatOpen()`. When the app's address carries `flock_chat=open`, AppShell opens its chat once at load, as the launcher would (the side panel wide, the sheet on a phone, the Chat page for `placement: "page"`). Flock's viewer adds it when the owner taps the notification for a chat they were writing in inside this app; an older Flock never sends it.
- FlockChatFrame leaves `flock_chat` out of the app page it reports to Flock.
- An untouched app: nothing to change. A customized app that kept `AppShell` and `AgentChat` as shipped: take `data/flock-host.ts`, `AppShell.tsx` and `FlockChatFrame.tsx`.

## 1.10.6 — app code can open the chat, with a message ready
- New `useChat()` (`components/AppShell/shell-chat.ts`, exported from the kit): `const { openChat, available } = useChat()`. `openChat({ message?, send? })` opens the app's chat as the launcher does (the side panel wide, the sheet on a phone, the Chat page for `placement: "page"`); `message` waits in the typing box, `send: true` sends it. Outside AppShell, with no chat, or beside a Flock chat: `available` is false and `openChat` does nothing.
- Flock's chat inside the app takes the message over the embed bridge (`flock:chat-compose`); an older Flock ignores it and the chat just opens.
- An untouched app: nothing to change. A customized app that kept `AppShell` and `AgentChat` as shipped: take `shell-chat.ts`, `AppShell.tsx`, `AgentChat.tsx`, `FlockChatFrame.tsx`, `data/flock-chat-bridge.ts` and `index.ts`. An app that calls `useChat` declares `"minFlockVersion": "0.22.1"`.

## 1.10.5 — the dark phone sheet is a deep card
- Dark only: the sheet card is a deep warm grey (`#262422`) just above the app, with a lighter hairline (`rgba(255,255,255,.14)`); the strong dim of the app (`rgba(0,0,0,.62)`) does the separating. Flock's chat inside draws its typing box `#35322f`. Light is unchanged.
- An untouched app: nothing to change. A customized app: take `app-shell.css`.

## 1.10.4 — the phone chat sheet stands out from the app
- The phone sheet is a distinct card: a warm off-white (`#fbf8f3`; dark `#43403c`) with a hairline border and an upward shadow, over a stronger dim of the app (`rgba(15,17,21,.18)`; dark `rgba(0,0,0,.62)`), set as `--sheet-scrim`, `--sheet-card`, `--sheet-line` and `--sheet-shadow` on `.fl-shell-sheet-wrap` (light and dark follow the shell's theme). The placeholder card uses the same colour. Flock's chat inside the sheet fills with the card colour and draws its typing box white (dark `#55514c`).
- An untouched app: nothing to change. A customized app that kept `AppShell` as shipped: take `app-shell.css`. One that styled `.fl-shell-sheet` itself: use the `--sheet-*` variables.

## 1.10.3 — no repeated title inside Flock; the launcher shows the agent's icon
- Wherever Flock already names the app above it (beside a Flock chat and that chat's full screen, `?flock_host=chat`; Flock's app page `/apps/view`, which now adds `?flock_host=viewer`), `AppShell` drops its title row (icon, name, subtitle) and starts with its tabs. The people (`AvatarStack`) and the theme switch (shown only when the app isn't following Flock's theme) move to the end of the tabs row; with side or no navigation they sit alone in a slim row (`.fl-shell-bar`), and nothing is drawn when neither shows. It is decided once at mount, and only inside a frame: opened on its own (its own tab, the home screen, bare `/a/<id>/`) the app keeps its title row, even with a marker left in its address. Inside a frame it is remembered for the tab (`sessionStorage` `flock-framed:<appId>`), so a path-routed app that dropped the query keeps it across a reload in the same frame. New `framedByFlock()` and `HOST_VIEWER` in `data/flock-host.ts`.
- The "Ask <agent>" launcher shows the agent's avatar (an emoji, or an image path or URL, in a white disc: `.fl-shell-launch-av`) when `/_me` names one (`agent.avatar`, which Flock now hands the app as `FLOCK_AGENT_AVATAR`), in place of the chat icon. A Flock picture (`?look=picture`) is drawn whole with the picture finish (`.fl-obj`), not cropped to the disc. None known, or an image that won't load (a visitor on a public app can't read Flock's avatar route): the chat icon as before. The app's colour (`--ua`) and the label are unchanged.
- An untouched app: nothing to change. A customized app that kept `AppShell` as shipped: take the new files (`data/flock-host.ts`, `data/hooks.ts`, `AppShell.tsx`, `app-shell.css`). One that changed `AppShell`'s header: skip the header when `framedByFlock()` is true and move its end items to the end of the tabs row. One that draws its own launcher: show `useMe().agent?.avatar` when it is set.

## 1.10.2 — the preloaded chat is ready before the tap
- The closed phone sheet now rests in place, invisible and unreachable (`inert`, `aria-hidden`), instead of below the screen, so phone browsers keep its preloaded chat running; it slides only while opening (from closed) or closing. The preload starts sooner (at most 500ms after the app settles). The placeholder shows only while the sheet is open and the chat isn't ready yet.
- `FlockChatFrame` handles the chat's new "New chat" (`flock:chat-new`): it forgets the app's remembered chat and its `flock_session`, and keeps that across a page reload for the tab (`sessionStorage` `flock-chat-fresh:<appId>`), so the next open starts a new chat until the first message is sent.
- An untouched app: nothing to change. A customized app that kept `AppShell`, `AgentChat` and `FlockChatFrame` as shipped: take the new files. One that styled the closed `.fl-shell-sheet-wrap` itself: it is now in view while closed (invisible, inert), not translated off-screen.

## 1.10.1 — a lighter phone chat sheet that opens instantly
- The phone chat sheet is a floating card (8px from the edges, about half the screen, 22px corners, a hairline border, a very faint scrim), so the app stays in view. Its padding clears the iPhone home indicator.
- The chat is preloaded quietly after the app settles (on `load`, then idle), hidden, so tapping Ask only slides the card up (about 200ms; none with reduced motion). Tapped before it is ready, the card shows a light placeholder with its own Close, swapped in place when the chat is shown. A visitor's chat pass is asked for only when they first open the chat; while hidden, the chat reports no presence and marks nothing seen. `ChatMode` gains `open` (the chat is in view now).
- An untouched app: nothing to change. A customized app that kept `AppShell`, `AgentChat` and `FlockChatFrame` as shipped: take the new files. One that styled `.fl-shell-sheet` itself: check it against the floating card.

## 1.10.0 — the app opens alone, its chat on the right at one width, one theme with its chat
- The side chat starts closed: the app opens alone, and the chat loads the first time it is opened, then stays loaded (hiding it does not reload it).
- One chat width beside an app, 480px (`--fl-chat-beside-app`), in Flock's chat and in the kit's. On wide screens the app's own chat sits on the RIGHT of the app, like a browser's side panel (1.9.0 had it on the left); its border is now on the chat's left edge.
- Phone full page: Flock's chat draws the top bar and the Chat | App tabs; the kit draws its own tabs only for the kit-chat fallback (and shrinking from that fallback returns to the sheet). Flock's viewer offers "Add to your home screen" from its own banner, shown on the App tab only; the kit reads it through the new viewer bridge (`data/flock-viewer.ts`).
- The chat's title bar stays above the phone keyboard: the kit adds `interactive-widget=resizes-content` to the viewport at runtime and sizes the chat layer from the visual viewport. The phone sheet never grows past that layer (`.fl-shell-sheet { max-height: 100% }`), so its header cannot clip under the keyboard on iOS.
- One theme. Opened from a Flock chat (`flock_from=chat`, or hosted by Flock), the app follows Flock's theme and hides its own theme toggle. On its own it keeps its own theme under a per-app key, `flock-app-theme:<id>` (it no longer reads or writes the shared `flock-theme`). The chat inside the app follows the app's theme (`flock:chat-theme`).
- The kit sends the viewer's own words (`said`) beside its prompt, so a visitor's transcript holds what they typed, not the recap or framing around it.
- An untouched app: nothing to change. A customized app that kept `AppShell`, `AgentChat` and `FlockChatFrame` as shipped: take the new files (`data/flock-viewer.ts` is new). One that styles `.fl-shell-agent` assuming the chat is on the left: flip its border to the left edge and any left-side spacing to the right. One that drew its own theme toggle on `flock-theme`: use the per-app key `flock-app-theme:<id>`, and hide the toggle when `flock_from=chat`. One that draws its own chat: send `said` (the viewer's own words) with each message if it should show cleanly in the transcript.

## 1.9.1 — visitors on public apps get Flock's chat
- A visitor (anyone on a public app who is not this Flock's owner) gets Flock's chat beside the app, as the owner does: `AgentChat` asks the kit for a short-lived visitor pass (`GET ./api/_agent/flock-chat-pass`) and `FlockChatFrame` hands it to the chat, with the agent's name, and the next pass before it expires. No pass (a private app, an older kit, the platform busy or unreachable): the kit's own chat, as before. What the visitor's agent may do is unchanged.
- An untouched app: nothing to change. A customized app that kept `AgentChat` as shipped: take the new files (`data/flock-chat-pass.ts` is new) with a kit that serves the pass route. One that draws its own chat: nothing to change.

## 1.9.0 — the chat on the left, a phone sheet that expands, none beside a Flock chat
- Chat moves to the left; on a phone the chat opens as a sheet that expands to Chat | App tabs; inside a Flock chat the app's own chat is hidden.
- Wide screens: `AppShell`'s side chat is a panel on the left of the app. Its Hide (Flock's chat) collapses it and the "Ask <agent>" button comes back to reopen it.
- Phones: the button opens a sheet over about 70% of the screen, with a grab handle. Flock's chat in it has Expand (a full page with the tabs **Chat** and **<app name>**; a dot on the app tab when a reply changed the app while Chat was in front) and Close; Shrink on the full page goes back to the sheet. The chat is drawn once, so switching never reloads it, and the app's page stays mounted under it.
- Opened beside a Flock chat (`?flock_host=chat`), the app draws no chat of its own: no panel, no button, no Chat page.
- New `ChatModeContext` / `useChatMode()`: `AppShell` tells the chat inside it how it is shown (`side`, `sheet` or `full`) and gives it `hide`, `expand`, `shrink`, `appChanged` and `showApp`. `AgentChat` reads it; without `AppShell` it is a side panel whose controls do nothing.
- A card in Flock's chat that opens this same app moves the app to the page it names (a `#/…` hash route, or a path under the app) and brings the app into view: on a phone the sheet closes, or the full page goes to the app tab.
- The chat Flock's chat settles on (a new one, or one from Earlier chats) is written into the app's address as `flock_session`, its page and hash kept: Flock's viewer goes Back to that chat, and a reload carries it on.
- An untouched app: nothing to change. A customized app that kept `AppShell` and `AgentChat` as shipped: take the new files (`chat-mode.ts` is new). One that changed `AppShell`: render `chat.render()` once, inside `<ChatModeContext.Provider>`, and move the panel before the page column. One that draws its own chat: nothing to change (the context is optional).

## 1.8.0 — one spacing scale, Stack and Row, and layout rules the check enforces
- The theme has a spacing scale: `--space-1` … `--space-7` (4, 8, 12, 16, 20, 24, 32px) and the layout gaps `--gap-page` (18px), `--gap-section` (12px), `--gap-box` (10px) and `--pad-box`. Page, Section, Card and Columns now read them: the same sizes as before.
- New `Stack` (children one under another) and `Row` (side by side, wrapping), both with `gap` xs, sm, md or lg. They are how a custom block spaces its parts.
- Blocks stacked in a `Card`'s body (paragraphs, lists, tables, divs) are now spaced by `--gap-box`; text and inline elements flow as before.
- `check-app` enforces the layout rules (COMPONENTS.md "Layout"): no box inside a box (Card, subtle Section, Callout, InlinePanel), no Columns inside a box, one Page at the top of a screen, and no inline `style` margin, padding or gap in a page.
- An untouched app: nothing to change. A customized app: replace a box inside a box with a Stack (or put the two side by side in Columns), Columns inside a box with Row, and inline spacing styles with Stack/Row or the `--space-*` tokens; the check names each one.

## 1.7.0 — a reply notifies unless the owner is looking at it
- `AgentChat` tells the kit what the viewer has in front of them, and that alone decides the reply notification (an open stream no longer counts: a stream stays up in a window nobody is looking at). While a conversation is on screen and the page is visible and focused, it posts `viewing` every 15 seconds to `/_agent/conversations/:id/viewing` (`{ on: true, client }`), and `{ on: false }` when that ends (hidden, blurred, closed, another conversation). A reply that lands meanwhile is not posted; a page that stops beating counts as gone after 30 seconds.
- Once it has shown the latest reply to a viewer who is there, it posts `/_agent/conversations/:id/seen` (`{ messageId }`). The kit keeps the read position and clears the notification only when the message seen is the conversation's latest reply. A conversation load no longer carries `?seen=1`: the kit ignores it.
- Inside Flock's app viewer the app is a frame, which has no focus of its own until it is clicked: Flock tells the frame whether its window is visible and focused (`flock:host-attention` messages; `src/data/attention.ts`), so an app opened from a notification counts as looked at straight away.
- New export `useChatPresence(conversationId, latestReplyId)`: the same two reports, for an app with its own chat UI.
- An untouched app: nothing to change. A customized app that kept `AgentChat` and `useAgentChat` as shipped: take the new files (`useChatPresence.ts` and `src/data/attention.ts` are new). One that changed them: drop `?seen=1` from the conversation load and call `useChatPresence(current?.id ?? null, <id of the latest assistant message>)` in the component that draws the thread. An app with its own chat UI on the kit's `/_agent` routes: call `useChatPresence` the same way (or post `viewing` and `seen` as above).

## 1.6.0 — agent chat replies notify the owner
- `AgentChat`: a reply that arrives while no page has its conversation in view becomes an app notification (the app's badge in Flock, the notification center, and the owner's devices). Opening the conversation, or having it in view when the reply lands, clears it. One notification per conversation; the next reply replaces it.
- A notification's tap opens the app at `/?chat=<conversation>`: `AgentChat` opens that conversation and removes `chat` from the address.
- Posting and clearing happen in the kit, which Flock supplies at every build: an app gets them on its next build whatever its library version. What this release adds in the app's own copy is the two widget halves: opening the conversation a notification names, and clearing it when a visible page reloads the conversation.
- An untouched app: nothing to change. A customized app that kept `AgentChat` and `useAgentChat` as shipped: take the new files. One that changed them: when merging, keep `chatFromUrl()` and its use on mount (the `?chat=` conversation opens first and `chat` leaves the address), and keep `?seen=1` on the conversation load while the page is visible. An app with its own chat UI on the kit's `/_agent` routes: send `?seen=1` on the conversation load while the page is in view, and open the conversation named by `?chat=` on start.

## 1.5.0 — figures written as text, objects as words, charts below zero
- `Value` reads a figure written as text as a number for the numeric kinds (money, compact, signed, percent, share, number): "₹1,42,000", "1.2L", "3.5 Cr", "7.25%", "12k" and "1,200" format like the numbers they are. Anything else shows as written.
- `Value` never prints "[object Object]": an object shows its label, title or name, else "key: value" pairs; a list shows "a, b". So do Detail, PropertyChips, Table cells and BigCard facts, which draw through it.
- `Chart` plots figures written as text instead of drawing them at 0. A bar chart with a negative value reaches below zero (the zero line is a tick, bars hang from it). A `share` of more than 6 slices shows the 5 largest and one "Other" slice (6 tones, so a 7th no longer repeats a colour).
- Chat blocks: an agent's near-miss is repaired before it is drawn, and a broken part is left out while the rest draws; only a block whose root cannot draw falls back to text. Every repair and every left-out part is reported to the chat with a hint. `Field` is no longer a chat component (a `Form` lists its fields in `fields`). Long lists in chat show 6 rows and "Show all N".
- Chat blocks: each chat component's definition carries its chat guidance (`chat`: what it is for, when not, what it needs, an example), and `src/chat/groups.ts` groups them; the agents' prompt and block reference are generated from these.
- Nothing to change in an app. An app that showed a raw text figure now shows it formatted; one that relied on a string staying as typed under a numeric kind should give it kind `text`.

## 1.4.3 — line charts fit their range
- A line `Chart`'s value axis now runs from just below its lowest point to just above its highest, in nice steps, so a movement shows (an index from 76,900 to 72,500 no longer draws flat on a 0 to 100,000 axis). Bars still start at zero.
- The axis column widens to fit its longest label, and a line's first and last date labels are no longer cut off at the edges.
- Nothing to change in an app.

## 1.4.2 — BigCard facts: comparison cards
- `BigCard` takes `facts`: up to 8 `{ label, value, kind? }` rows under the caption, one single line each (label small and grey, value formatted by `kind` like the card's own value). Give every card in a row the same labels in the same order and they read as a side-by-side comparison. Works plain and as a pickable card, so a `Choice` of cards can carry them.
- Chat blocks: a card's facts also appear as "Label: value" lines in the text fallback (web and Telegram).
- Nothing to change in an app: `facts` is optional, existing cards look the same.

## 1.4.1 — buttons and coral match core Flock
- `Button` takes core Flock's shape: 12px corners, 13px semibold text, 34px tall (30px `size="sm"`), flat (no shadow, no lift on hover).
- `ink` (the default) is now filled with the app accent like `app`, so an app's main button is its accent colour; the default coral is Flock's `#f06040` with white text. `soft` is Flock's pale secondary.
- Theme: `--ua-coral` is `#f06040` and `--accent` is `#b83c20` (dark: `#f06040`), as in core Flock.
- Nothing to change in an app: an untouched app gets the look with its next auto-update; an app whose accent was picked keeps it.

## 1.4.0 — chat blocks: BigCard, Choice, Questions, MiniApp
- New `BigCard`: a card for one option or fact (label, title, value, optional detail), as a plain block or, with `as="button"`, a pickable card.
- New `Choice`: a question with 2 to 8 options, as buttons or `BigCard`s, plus an "Or write your own answer…" field. `multi` waits for a submit button; the answer is `{ picked: string[] }` or `{ written: string }`.
- New `Questions`: 2 to 6 `Choice` children as pill tabs with one "Send answers" button. An answer ticks its tab and moves to the next unanswered one; "N of M chosen" sits beside Submit, which waits for every tab. Answers are keyed by each Choice's `tab` (else its `question`). `onChange` fires on every pick, write or change; `onSubmit` fires once. `answers` and `disabled` restore and lock it after a reload.
- New `MiniApp` and `Tab`: a framed block with a subtitle, a title, pill tabs (one per `Tab`) and an optional "Make it an app" button (`makeApp`, `onMakeApp`).
- `MiniApp` with a single `Tab` shows that tab's content with no tab bar (tabs are for 2 or more parts).
- `BigCard` as a button renders its chips as spans (a button holds no list), and a chosen card with no label keeps its title clear of the "Chosen" badge. `value` is the big figure only (a price, a time, a count), never an id.
- `Choice`: Enter while an input method is composing (Hindi, Kannada and other transliteration keyboards) no longer sends the written answer.
- `Tabs`: `count` also takes a string. Nothing to migrate; existing apps are unaffected.
- Chat blocks only (the chat frame, not apps): cards are compact in a chat (`.fl-chatblock`); a top-level `Checklist`, `Choice`, `Form` or `SlotPicker` given a `title`, `subtitle` or `makeApp` is drawn inside a `MiniApp` holding them; any other unknown prop is left out with a warning; a block that still cannot be drawn shows its words under "Shown as text". Nothing to migrate.

## 1.3.1 — send while the agent is replying
- `AgentChat`: the send box and button stay enabled while the agent is still replying (push kit). A message sent mid-reply shows in the conversation at once, the agent keeps showing as working, and each reply lands after the message it answers. With an older kit, which holds one turn at a time, a send mid-reply still says "still replying" and keeps the text. Nothing to migrate.

## 1.3.0 — editors open in place
- New rule in COMPONENTS.md: an add or edit form opens where it was asked for, directly under the row, item, card or slot clicked, pushing what is below down; never at the top of the page.
- `Table`, `RowList`, `Gallery`, `Board`, `Schedule` and `Calendar` (timeline and schedule views) take `expanded: { at, content, onClose, label? }`: `content` renders in place under the row whose key is `at` (its id, or `rowKey`). Table gives it a full-width row on desktop and a band under the card on phones; Gallery a full-width band in the row after the card (the cards after it still fill the clicked card's row); Board a slot under the card in its column. RowList, Gallery, Board and Schedule take `rowKey` too.
- `Schedule` also opens it at an add spot: `at: scheduleAddKey(date, slot?)` puts it under that "+ Add" (which shows `aria-expanded`); a folded empty day unfolds for it, and a day-wide add on a day listed by slot opens at the end of the day.
- New `InlinePanel` (what `expanded` renders, also for lists laid out by hand): it focuses its first field (or a field its content focused itself, or itself while it holds no field yet, and the first field when one appears), scrolls only when part of it is off screen (`block: "nearest"`, the top for a panel taller than the screen, no smooth scroll under reduced motion), closes on Escape (not an Escape meant for a dialog inside it), and on close returns focus to the control that opened it, else to the row it opened under. It never widens the list on a phone.
- Migrate: a page that renders an add or edit Card above its list (a `selected` panel or an `editing` Card before the Table) moves it into the list's `expanded`, and drops any `scrollIntoView` of its own. Keys of Calendar timeline and schedule rows are their ids now, not their positions. Nothing else changes for apps that do not pass `expanded`.

## 1.2.7 — Board Move button is a phone tap target
- `Board`: the card's Move button and the Move-to menu items are 40px tall on phones and touch (the button measured 24px). Nothing to migrate.

## 1.2.6 — a change asked for in the chat shows up without a reload
- `AgentChat` keeps checking the open conversation (every 3s) while a change it handed to the paired agent is not reported back yet (the kit's `awaitingChange` on `GET _agent/conversations/:id`), and when the report lands it checks for the redeploy, so the page reloads into the new version (or shows "App updated · Reload" while something is typed). The poll for a change alone stops after 30 minutes. Before, a tab whose stream was shut (hidden, or a full connection pool) only saw the change after a manual reload.
- The page also checks for a redeploy when it comes back into view (focus, or visible again). Nothing to migrate; with an older kit (no `awaitingChange`) the chat behaves as in 1.2.4.

## 1.2.5 — more phone tap targets
- `AppShell`: the side-nav page buttons (the rail becomes a row at 900px and measured 32px) and the chat sheet's close button are 40px on phones and touch. A `Table` row card's title button is 40px tall too (padding plus an equal negative margin, so the card does not grow). Nothing to migrate.

## 1.2.4 — one live stream per page
- `AgentChat` follows its conversation on the page's one data stream (`./api/_data/_events?conversationId=…`) instead of a stream of its own, so an app page holds one of the browser's six connections to the Flock host, not two. New `followConversation(id, handlers)` in the data client. Needs an app kit whose `/_data/_events` carries conversation events (same release); a redeploy is still checked on each reconnect of that one stream; with an older kit the chat still updates through its 3s poll while the agent replies. Nothing to migrate.

## 1.2.3 — Undo lasts, phone tap targets, page reloads on a redeploy
- `Toast`: a toast with an action (Undo) stays 10s, not 5s; hover or focus still holds it open.
- Phones and touch: small buttons, the filter pill and its select, the Add item field, and links and selects in a Table row card are 40px tap targets (padding, or a pseudo-element, so cards do not grow).
- The page records its `X-App-Deploy-Id` at load and checks it when the event stream reconnects: after a redeploy (a new column, a new page) it reloads itself, once. While something is typed or a dialog is open it shows an "App updated · Reload" banner in `AppShell` instead, and reloads when the edit ends. New `checkDeploy()` in `data/client`.
- `AgentChat` shows a hand-off to the paired agent as an ordinary reply ("Handed to <agent>. I'll tell you here when it's done."), not as "couldn't be reached". Nothing to migrate.
- `AppShell` also shows "<agent> removed N of your rows" with Undo and Dismiss when an agent deletes rows the owner wrote (`useOwnerRemovals()` in `data`, fed by the kit's `GET _data/_changes/owner-removals`). Nothing to migrate.

## 1.2.2 — reword what is shown, not what is stored
- `Field`: `options` on a `text` field are suggestions (a datalist; any text is accepted). A `select` takes `optionLabels` (value → words shown). `Value`, `Detail` fields and `Table` columns of kind `select` take `labels` (stored value → words shown; an unlisted value shows as stored). Nothing to migrate.

## 1.2.1 — pages follow writes and wake on input
- Any successful write through the kit (create, edit, delete, Undo, Clear samples) now refreshes every list and banner on the page, not only the hook that made it. No page code needs to refetch by hand.
- A page that shows nothing for a while (hidden tab, never reported visible) wakes its live stream on focus, click, tap or key press and refetches.
- `AgentChat` reopens the conversation the page last had open (kept per app path), else the latest if under a day old, and polls it every 3s while the agent is replying. Nothing to migrate.

## 1.2.0 — app info, labels, sample rows
- New `useApp()`: the app's name, display (`object`, `accent`, `labels`, `starters`) and the owner's settings from `/api/_app`, shared by the page and refetched when a setting changes. New `label(key, fallback)` reads `display.labels`. Display and settings are empty until loaded, so keep the template's current values as fallbacks. Nothing to migrate; adopting them is optional.
- Sample rows: rows read with `_sample: true` render lighter (new `--sample` opacity token, light and dark) with a "Sample" chip in Table, RowList, Board, Schedule, Calendar (a screen-reader "Sample" on month chips) and Gallery. Checklist items take `sample` and Detail takes `sample`; pass the row's `_sample` to them. Nothing to migrate: apps without samples look the same.
- AppShell shows a one-line banner while the kit holds sample rows, with Clear samples (hidden for anonymous viewers, whom the kit refuses). Clear toasts what it cleared and kept, with Undo of the whole group. `useSamples()` exposes the same counts and `clear()`. The shell now reads `/api/_data/_schema` once and on data events; an app with no kit schema shows no banner.
- Toast action buttons have a 40px tap target around the pill (no visual change).
- Exports `SampleChip` and `isSample` for custom views that list rows.
- `LineItems` takes `noTax` for a seller not registered for GST: the GST column and rate pickers are hidden, the worked-out totals carry no tax, and new lines start at 0%. Nothing to migrate.

## 1.1.0 — named accents, GFM tables, Schedule
- New `Schedule`: dated items one block per day from today, today and tomorrow big, empty days folded. Use it instead of Calendar's `week-grid` for any weekly plan; keep `week-grid` as an optional "Grid" toggle. Nothing to migrate.
- New `SlotPicker`: one day's time slots as tappable chips (free, taken, picked), phone-first. Pair it with a server that rejects overlaps. Nothing to migrate.
- New `LineItems`: editable invoice lines (description, qty, price, GST %) with line amounts and a subtotal / CGST+SGST or IGST / total block; each line stacks as a card when LineItems itself is narrower than 680px (a container query, so a side nav plus side chat on a laptop also gets cards). Also exports `lineItemTotals`. `formatINR` takes `{ exact: true }` for two decimals (`₹1,234.50`). Nothing to migrate.
- GST rates: `LineItems` offers 0, 5, 18 and 40% (the slabs since 22 Sep 2025) plus a "Custom %" box for any rate from 0 to 100 with two decimals (3% on gold). `GST_RATES` and `parseGstRate` are exported from the library. A line stored at a rate no longer offered (12%, 28%) opens as Custom with its value and totals at that rate; nothing is re-mapped. Apps that pass their own `rates` keep them.
- AppShell `accent` takes a name: `coral`, `teal`, `blue`, `green`, `violet` or `amber` (theme tokens `--ua-<name>`, light and dark). A hex value is no longer applied (the app falls back to coral) and `check-app.sh` rejects it. Change `accent="#0f766e"` to the nearest name, for example `accent="teal"`.
- Custom CSS that needs the accent uses `var(--ua)`, or `var(--ua-teal)` and the like for a specific one; never a hex. `check-app.sh` rejects a literal colour as the value of `--ua*` in CSS.
- Dark theme: `--on-ua` is dark, so button text on the lighter dark accents reads at 4.5:1; light amber is deeper. `--ua` defaults to `var(--ua-coral)`, now the deeper brand coral `#c2452a` in light (white text 5:1).
- AppShell side chat is pinned to the viewport: it is its own full-height column beside the app (sticky, `100dvh`), its thread scrolls inside, and the message box is always on screen however tall the page or long the transcript. From 721 to 900px it sits under the page at a fixed height (560px or the viewport) instead of growing. The header, tabs and page now sit in a `.fl-shell-col` wrapper and `.fl-shell-agent` is no longer inside `.fl-shell-grid`; custom CSS that sized a third grid column for the chat must go. In the phone sheet the chat header keeps clear of the close button, so History is tappable.
- AgentChat: pressing Enter while the agent is still replying no longer does nothing; the text stays in the box and the error line says the agent is still replying.
- Markdown (and so AgentChat replies) renders GFM tables as real tables, scrolling sideways inside the message. This needs `remark-gfm` in the app's `devDependencies`; an update re-copies `src/flock/` but not `package.json`, so add `"remark-gfm": "^4.0.1"` there and run `bun install`.

## 1.0.0 — first release
- Dark theme objects: the outline stays dark ink, with a lit gloss, a cream die-cut border and a soft lift instead of the cream outline and black offset shadow. Tokens `--obj-die` and `--obj-lift` are new; `--obj-ink` is `#1d1b16` in dark. `ObjectIcon` adds a hidden `fl-obj-gloss` SVG filter to the page itself; light theme is unchanged. After the update, remove any custom CSS that restyled `.fl-obj` filters.
- `percent` is a signed change (`+12.0%`, green or red); the new `share` kind is a plain `64%`. Use `share` for completion or share-of-total values in Value, StatStrip, HeroStat, Progress, Table and Chart (Chart treats both as a plain %).
- Class names: Table's phone cards are `.fl-tcard*` (was `.fl-card*`), Board's cards `.fl-bcard` and its Move menu `.fl-bmenu` (was `.fl-card`, `.fl-menu`). Custom CSS that targeted those names must follow.
- Gallery takes `loading`, `error`, `empty`, `hasMore` and `onLoadMore` like Table and RowList. A failed Load more keeps the loaded rows and toasts; `useTable().loading` is true while a page loads. PropertyChips items take `tones`.
- Table, RowList and Gallery rows no longer open when Enter, Space or a click comes from a link or control inside them.
- Initial components, `flock` theme (light + dark), app kit client, objects wave 1.
- Apps on no version: none exist; nothing to migrate.
