# Family Calendar 3.0.0: the shared contract for lanes L2a, L3, L3-interview and L4

Owner go: 2026-11-22. Design source: canvas https://claude.ai/artifact/WJvXaUNGiPj1yGQA588cKc (artboards App, Interview,
Email Desk, Butler). This file fixes the ops' input and output, so the four lanes build at the same time. A lane that needs a
change here stops and reports it; it never changes the contract on its own.

## The lanes

| Lane | Worktree (branch) | Builds |
|---|---|---|
| L3 | `~/Developer/mp-famcal3` (`feat/family-calendar-3`, from marketplace `feat/meal-planner-simple`) | `apps/family-calendar` 2.1.0 → 3.0.0 |
| L4 | `~/Developer/mp-butler-briefs` (`feat/family-butler-briefs`, same base) | `templates/family-butler` 1.8.0 → 1.9.0 |
| L2a | `~/Developer/flock-family-push` (`feat/family-email-push`, from flock `feat/personal-mail-rules`) | Flock server: store the family/personal mark, push family items to `import_events` |
| L3-interview | `~/Developer/flock-interview-cal` (`feat/interview-calendar-events`, from flock `feat/interview-engine`) | the interview's calendar part: events, not reminders |

## Decided (owner, 21–22 Nov; do not reopen)

- Email items reach the Family Calendar by **push**: Flock's harvest code (not an agent) sends family items to `import_events`.
  The model only labels an item `audience: family | personal`; code routes it.
- Family items get no personal Calendar Desk event and no personal to-do. Personal items keep today's path.
- No family group, or no Family Calendar installed in it: everything takes the personal path, as today.
- The calendar holds events only. The `reminders` table goes. A due date is an event of kind `deadline`; what someone must
  do is a to-do tied to an event, published through the app SDK's `tasks.publish` with `due` and `showFrom`.
- To-dos stay hidden until their show-from date (own lead, else 3 days before due).
- The 9 pm brief covers tomorrow, so no per-event "evening before" reminder.
- Prep is planned only for imported events (email, portal, groups), never for recurring or typed-in ones.
- All events are visible to the whole family.

## Data (L3)

`events` gains:
- `repeat`: adds `yearly` (Feb 29 falls on Feb 28 in other years, as `flock-app/server/src/wiki/event-gate.ts` eventDateOf).
- `kind`: `event` (default) | `deadline`.
- `status`: `active` (default) | `cancelled`. A cancellation never deletes.
- `added_by`: a member name, or null for imports (they show their sources).
- `planned_at` (ms) and `plan_basis` (`"YYYY-MM-DD"` or `"YYYY-MM-DDTHH:MM"`, the date and time it was planned for).
- `imported`: 1 for an event first made by `import_events` (only these are planned).

New table `event_sources`: `event_id`, `source` (e.g. `email:<personId>`), `ref` (the source's item ref), `label` (shown:
"Shiva's email", "MyClassBoard"), `match` (JSON array of identifiers), `first_seen_at`, `last_seen_at`.
Two people's copies of one mail = one event, two source rows.

Migration from 2.1.0: each `reminders` row → a `deadline` event on its due date with one to-do (its title, due that day);
repeating reminders become repeating events. `reminder_minutes` equal to the old "evening before" value → null.

## `import_events` (new op; caller: L2a now, connectors later)

`POST /api/apps/family-calendar/ops/import_events`

```json
{
  "source": "email:<personId>",
  "label": "Shiva's email",
  "items": [
    {
      "ref": "<Message-ID>#pay-school-fee",
      "match": ["<Message-ID>", "INV-2291"],
      "kind": "deadline",
      "title": "School fee due",
      "date": "2026-12-10",
      "start_time": "09:00",
      "end_time": "10:00",
      "who": "Agastya",
      "location": "Greenwood High",
      "notes": "Term 3, Rs 42,000",
      "cancelled": false,
      "todos": [{ "title": "Pay the school fee", "due": "2026-12-10", "show_from": "2026-12-03" }]
    }
  ]
}
```

- `source`, `items[].ref`, `items[].title`, `items[].date` are required; the rest optional. `kind` defaults to `event`.
- `ref` is stable for the same item from the same source: re-sending updates it. For email: the mail's RFC `Message-ID`
  header (the same in every recipient's copy, unlike Gmail's own id) + `#` + a slug of the title.
- `match`: identifiers that name the real-world thing (Message-ID, PNR, invoice or policy number, portal item id).
- `who`: a member name; an unknown name is added as a member, as `add_events` does today.
- `cancelled: true` marks the matched event cancelled (and withdraws its open to-dos); with no match it is ignored.
- `todos`: family to-dos the source itself named ("pay by 10 Dec"). Published as the event's to-dos; due on or before the
  event's date; `show_from` defaults to 3 days before `due`.
- At most 50 items and 32 KB per call. One bad item is refused alone (its `result: "refused"` with a reason); the rest go in.

**Matching (code, in the app).** An incoming item is the same as an existing, non-repeating event when any holds:
1. same `source` and same `ref`;
2. a shared `match` identifier and the same date (or, for an item from the same source and ref, any date: a move);
3. the same date, titles that name the same thing (normalised word sets: one contains the other, or Jaccard ≥ 0.5),
   and times within 60 minutes or one has no time.
When unsure, keep both. A matched item adds a source row; it updates fields only when it comes from the source that made
the event, or when it fills a field that was empty. A date change from the event's own source is a move: `plan_basis`
stays, so plan-prep sees it as moved.

Answer:

```json
{
  "results": [
    { "ref": "<Message-ID>#pay-school-fee", "id": "<event id>", "result": "added | merged | updated | moved | cancelled | unchanged | ignored | refused", "reason": "only for refused or ignored" }
  ],
  "members_added": ["Meera"]
}
```

Idempotent: the same call twice answers `unchanged` the second time and makes no new rows or to-dos.

## To-dos (L3)

Published by the app with the SDK's `tasks.publish`: `sourceRef` = `event:<eventId>:<key>` (key = a slug of the title, or
the plan step's key), `due` (the date), `showFrom`. The event shows its count ("2 to-dos"); a tap lists them; ticking one
settles it. Until the group to-dos lane lands, these sit on the app owner's Home; nothing in this contract changes then.

## `plan-prep` routine and `plan_done` op (L3; the agent is Family Butler)

Hourly. Takes events with `imported = 1`, `status = active`, dated today to 90 days ahead, that were never planned or whose
date or time no longer equals `plan_basis`. Nothing to plan: no wake, no model call. Otherwise one wake of the app's agent
with the app's own prompt (modelled on Calendar Desk's `plan_events`, family version: what must the family physically do
before it: buy, pay, sign and return, send, book, collect; nothing is the usual answer; at most 3 steps per event) and:

```json
{
  "planId": "p-<ms>",
  "today": "2026-11-22", "nowLocal": "10:00", "timezone": "Asia/Kolkata",
  "events": [
    { "ref": "e1", "id": "<event id>", "title": "Annual Day", "date": "2026-12-12", "start_time": "10:00", "who": "Agastya",
      "location": null, "notes": "costume: farmer", "kind": "event", "sources": ["MyClassBoard"],
      "change": "new | moved", "was": { "date": "2026-12-10", "start_time": "10:00" },
      "steps": [{ "key": "buy-costume", "title": "Buy Agastya's costume", "due": "2026-12-05", "show_from": "2026-12-01", "closed": false }] }
  ]
}
```

`POST /api/apps/family-calendar/ops/plan_done`:

```json
{ "planId": "p-…", "events": [
  { "event": "e1", "steps": [{ "key": "buy-costume", "title": "Buy Agastya's costume", "due": "2026-12-05", "show_from": "2026-12-01", "why": "The school asked for a farmer costume." }] },
  { "event": "e2", "steps": [] } ] }
```

Answer `{ "accepted": ["e1/buy-costume"], "refused": [{ "step": "e3/x", "reason": "…" }] }`. Rules the app enforces: a step
due on or before its event, `show_from` ≤ `due`, at most 3 open steps per event, a closed key never re-made. Every event
listed is marked planned (`planned_at`, `plan_basis`) even with no steps. A moved event's open steps are re-dated by the
agent with the same keys; a cancelled event's open steps are withdrawn by the app.

## `brief` op (L3 builds it; L4's briefs read it)

`POST /api/apps/family-calendar/ops/brief` with `{ "kind": "morning" | "evening" }`.

```json
{
  "day": "2026-11-23",
  "timezone": "Asia/Kolkata",
  "events": [
    { "id": "…", "title": "Skating", "start_time": "16:00", "end_time": "17:30", "who": "Agastya", "location": null,
      "notes": "Lakshmi drops", "kind": "event", "status": "active", "sources": [], "added_by": "Shiva",
      "todos": { "open": 1, "titles": ["Carry skates"] } }
  ],
  "changed": [ { "id": "…", "title": "PTM", "date": "2026-12-06", "status": "cancelled | moved", "was": "2026-12-05" } ],
  "new": [ { "id": "…", "title": "Annual Day", "date": "2026-12-12", "sources": ["MyClassBoard"] } ],
  "todos_due": [ { "title": "Sign the trip form", "due": "2026-11-27", "event": "School trip" } ]
}
```

- `morning`: `day` = today; `todos_due` = open to-dos already showing (past show-from), soonest first.
- `evening`: `day` = tomorrow; `todos_due` = open to-dos due tomorrow.
- `new` and `changed`: imports added, moved or cancelled since the last brief of either kind; the call moves that mark on.
- Repeating events appear on the days they fall. Cancelled events appear in `events` with `status: "cancelled"` on their day.
- An empty day answers empty arrays; the brief then says nothing (L4's prompt).

## `due-reminders` (L3, changed)

Keeps: the nudge before a timed event (its `reminder_minutes`, default 30 for new timed imports) and a `deadline` event's
reminder 7 days before. Drops: "evening before". Lines go to the Family group (who: everyone) as today's wake does.

## L2a: what Flock sends

- After extraction of a personal mailbox, each dated fact or to-do with `audience: "family"` is pushed; `personal` and
  unlabelled ones keep today's path.
- The target: the Family Calendar app installed as a group app of a group the mailbox's person is in (`isGroupApp`,
  `appGroupChatOf`). None: today's path. When more than one of the person's groups has one, the oldest group's is used and the others are logged.
- One call per harvest run per mailbox, items grouped, `source` = `email:<personId>`, `label` = "<first name>'s email".
- A family fact pushed is not offered to Calendar Desk (the event gate skips it); a family to-do is not published to the
  person's Home. When the push fails, both fall back to today's path for that run and the failure is logged.
- The only cross-app call allowed: Flock's own harvest calling `import_events` on that group app, as that person.

## L4: what Family Butler does with it

- Family Calendar in the template's apps; Family Butler is its connected agent.
- 8 am morning brief and 9 pm evening brief call `brief` and post to the Family group (deliverTo = the family's group room).
  Short and scannable; nothing when every array is empty. Weather stays in the morning one.
- google-calendar dropped from the template.
- Model pinning (Sonnet 4.6 today) stays as it is: an open owner question, not this lane's call.

## Not in this round

The portal, WhatsApp and Teams connectors (L5–L7); Project B (L2b); group to-dos (its own lane); the person's prep offer
"add to the family calendar?" (L8).
