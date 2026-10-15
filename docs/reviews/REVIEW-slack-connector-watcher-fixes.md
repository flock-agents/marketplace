# Fix: Slack connector `requires` format + slack-watcher event-routine creation

**Author:** Wire
**Date:** 2026-09-08
**Scope:** `skills/slack/flock.skill.json`, `skills/slack-watcher/flock.skill.json`, `catalog.json`
**Tags:** `slack-v1.0.1`, `slack-watcher-v1.0.1`

## Issue 1 — Slack connector does not offer an account connection

### Root cause (platform code, for reference — not changed here)
`flock-app/server/src/marketplace/installer.ts:204 normalizeSkillRequires()` accepts a
manifest `requires` in exactly three shapes:
1. a **top-level array** → `{ requirements: raw }` (e.g. `linear`)
2. an object with **`anyOf`** array → `{ requirements: obj.anyOf }` (e.g. `gmail`)
3. a **keyed map** whose *values* are objects carrying a `.type` (legacy)

The Slack connector declared a **flat single object** (`{ type, service, loginUrl, ... }`).
`Object.entries()` of it yields only string values — none is an object with `.type` — so the
normalizer returns **`undefined`**. Downstream, `routes/skills.ts:366`
(`s.requires?.find(r => r.type === "browser_session")`) then finds nothing, so **no Connect
affordance renders**. LinkedIn/Zepto/Amazon use the same flat shape and share this latent bug,
but are out of scope here (do-not-break) — flagged below.

### Fix (this repo)
Wrapped the requirement in a **top-level array** (matches `linear`, the working single-requirement
connector; normalizes to a non-undefined array):

```json
"requires": [
  { "type": "browser_session", "service": "slack", "loginUrl": "https://app.slack.com", ... }
]
```

Verified end-to-end: array → `normalizeSkillRequires` returns the array → `s.requires.find(...)`
matches the browser_session entry → `auth: { type: "browser_session", session_name: "slack" }`
→ Connect option renders. `loginUrl` is a recognized, validated field
(`skills-registry.ts:531` requires http(s)); Slack is **not** in `service-templates.ts`, so
keeping an explicit `loginUrl` is what points the browser session at the Slack login page.

## Issue 2 — slack-watcher routine created as scheduled instead of event-based

### Root cause (platform code, for reference — not changed here)
Both routine-provisioning paths check `schedule` **before** the event trigger:
- `instantiate-use-case-skill.ts:31` — `if (r.schedule) return { schedule }` (returns early,
  dropping `trigger`).
- `frontend/.../SkillInstallModal.tsx:67` — `if (r.schedule) {create cron} else if (r.connectorId)
  {create event routine}`.

The slack-watcher `watch-channels` routine declared **both** `trigger` (event) **and**
`schedule: "*/30 * * * *"`. Schedule-first precedence meant it was always created as a
periodic **cron**, never as an event routine. (draft-replies `on-new-mail` works precisely
because it has `trigger` and **no** `schedule`; its `linkedin-sweep` has `schedule` and no
`trigger`.)

### Fix (this repo)
Removed the `schedule` field from `watch-channels`. Kept `trigger`, `eventKinds`,
`executionMode: "llm"`, the `configSchema`, and the significance predicate scripts. Now
`r.schedule` is falsy → both paths take the event branch → routine is created as
`trigger: { type: "event", sourceId: "slack", eventKinds: ["slack_message","slack_mention"] }`,
matching draft-replies `on-new-mail` exactly.

## Open items flagged (NOT fixed here — need decisions / separate work)

### A. Daily-digest wake cadence needs a platform-side addition
Slack is high-volume; the desired behavior is "wake once a day and process everything
accumulated since the last wake." **The platform does not support this today.**
- The ingest loop ticks every **60s** (`ingest-runner.ts:87 INGEST_TICK_INTERVAL_MS = 60_000`)
  and calls `dispatchEventLlmWakes` each tick; an event+llm routine is woken on **every tick that
  lands new journal entries**. On a busy workspace that is a wake ~every minute.
- There is **no** per-routine `minWakeInterval` / batch-interval / cadence anywhere in
  `event-llm-dispatcher.ts` or the `Routine` model.
- The significance predicate cannot substitute: it filters **per-entry**, and suppressed entries
  **advance `lastWakeAt`** (dispatcher lines 219–227) — i.e. they are dropped, not deferred. Routing
  a "cadence" value through it would silently drop messages, not batch them.

**Recommendation:** add an optional `minWakeIntervalMs` (or `wakeCadence`) to the `Routine` model,
and in `dispatchEventLlmWakes` skip the wake **without advancing `lastWakeAt`** while
`now - lastWakeAt < minWakeIntervalMs`, so entries accumulate and are summarized in one daily wake.
Then surface a config field (default daily) in slack-watcher's `configSchema`. Deliberately **not**
adding an inert `configSchema` field now — it would imply behavior that does not exist. Requires
crafo-claw change + Vik/Sam review.

### B. Significance predicate wiring (pre-existing, connector scope)
`filterSignificant` (`event-llm-dispatcher.ts:184`) executes `functionName: "shouldTrigger"` on
`skillId: trigger.sourceId` (the **slack connector**), but the scripts are `significance.sh/ts`
in the **slack-watcher** skill. The predicate will likely not be resolved and the flow fails
**open** (wakes for all — no breakage), so the config filters (`keywords`, `ignoreBots`) won't
actually apply until this is reconciled. Left as-is per task scope ("keep the significance
predicate"); flagged for the connector/watcher owners.

## Verification
- `jq empty` passes on both manifests + `catalog.json`.
- `slack.requires` is an array; `slack-watcher` routine has `trigger`, no `schedule`.
- catalog item count unchanged (18); `gmail` / `draft-replies` entries untouched.
- Traced both fixes through the actual platform code paths (installer, routes/skills,
  instantiate-use-case-skill, SkillInstallModal).

---

## Review verdict — Vik (backend), 2026-09-08

**PASS** — no P0s.

- **(1) Array `requires`** — verified against `normalizeSkillRequires` (installer.ts:204-251): the flat
  object fell through the keyed-map branch (values are strings, none an object with `.type`) and
  returned `undefined` at line 248. The array form hits `Array.isArray(raw)` at line 206 and matches
  `linear` exactly. `loginUrl` retention correct (Slack absent from `service-templates.ts`).
- **(2) Removing `schedule`** — both paths confirmed early-return/branch on `r.schedule`
  (`instantiate-use-case-skill.ts:31`, `SkillInstallModal.tsx:67`); with it gone both fall through to
  the event branch, matching draft-replies `on-new-mail`.
- **(3) No regressions** — catalog diff surgical; only `slack` + `slack-watcher` changed; all 18 items
  present; `gmail` / `draft-replies` / `linear` untouched.
- **Open item A (cadence)** — agrees: significance can only drop (lastWakeAt advances past suppressed
  entries, dispatcher:219-227), no `minWakeInterval` exists; an inert config field "would be a lie in
  the manifest." Flag as a separate platform ticket (new Routine field + dispatcher skip-without-advance).
- **Open item B (significance wiring)** — confirmed pre-existing gap; fails open (wakes for all), so no
  regression, but `ignoreBots`/`keywords` won't filter until reconciled. Flagged for next pass.
- **Minor follow-up** — LinkedIn/Zepto/Amazon share the same flat `requires` shape; worth a future
  catalog sweep to wrap those too (correctly out of scope here).

Verdict: **Good to commit.**
