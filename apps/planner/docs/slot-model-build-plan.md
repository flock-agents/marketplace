# Slot model — build plan and resume notes (23 Nov 2026)

Start here after the session compaction. The design is settled; nothing of the slot model is built yet.

## Read first
- Spec (final, owner-approved, no open questions): `apps/planner/docs/slot-model-spec.md` (commits 6e096e2 → 68c3653).
- Design page: https://claude.ai/artifact/G6kUr6SWuXe75wQoCLNmHD (source: session scratchpad `meal-planner-pipeline.html`).
- Memory: `planner-slot-model.md`, `planner-two-evals.md`, `app-owns-setup-consolidation.md`.
- Old run log / handover: `~/Developer/flock/.superpowers-archive/HANDOVER-whatsapp-onboarding-testing.md` (the `~/Developer/flock-wa-onboarding` folder no longer exists).

## Where the code is
| Repo / folder | Branch | State |
|---|---|---|
| `~/Developer/marketplace-runner` (planner) | `feat/planner-runner-saves` | apply_setup (3 parallel reads), how-often, setup fixes, evals (`apps/planner/evals/`), spec. Suite 471/0. Not pushed. |
| `~/Developer/mp-plan-best` | `feat/planner-plan-best` | Sol/best-tier experiment. NOT to merge (weekly plans stay on balanced). Keep only as reference. |
| `~/Developer/flock-runner` (worktree of `~/Developer/flock`) | `feat/interview-runner` @ 5ea1aa08a | setupApply flow, ack+question in one message, app-model `best` tier (5ea1aa08a — unused by the planner now; decide keep/revert). Folder was re-created from the branch on 23 Nov. |
| `~/Developer/flock-sim` | `feat/interview-sim` | must-pass bar, 6 scenarios, two stacks (`--stacks a,b`). Last merged Flock at 9b31c9d5c. |
Other planner worktrees (`mp-how-often`, `mp-setup-fixes`, `mp-dish-eaters`, `mp-evals`) are merged; can be removed. Stray locked worktree `~/Developer/flock/.claude/worktrees/agent-a8e6597d4754221dc` can be removed.

## Build order (lanes from the spec §9; parallel where independent)
1. **Evals first** — update Eval 1 (slots, attendance from weekly patterns, library with frequency/days/contains/origin, personal vs shared placement, seed history) and Eval 2 (slot-days filled, rules via open contains, frequency/repeat windows with staples exempt, shape tracked, judge). Add held-out households h9–h12 (written separately, run only at milestones), the day-word lint, the name guard, a "no new word lists" guard for setup.
2. **Schema** (lane A): new tables replace old ones outright; old ops removed (no migration — new interview unreleased).
3. **Setup v2** (apply_setup): slots incl. add-on slots, library + open contains batch, seed history, rules with quotes, weekday attendance read-back, corrections applied as diffs.
4. **Plan v2** (make_plan): slot-days (usual − weekly absences ± calendar events − skip_days/fasts + guests), feasibility check (seed + confirmed counts only), ordered slot calls (breakfast → tiffin → lunch → dinner → add-ons, ≤3 concurrent), checks, rotation fill, ingredients, message (All-week notes once; festival question inferred by the routine).
5. **Later changes + feedback**: set_slot, set_slot_day (guests, occasion), add_dish (link), set_rule, set_setting, record_made, record_feedback; next-day question for untried dishes (planner_suggested + reel/link adds).
6. **Flock**: household read structures weekly patterns + nicknames (per speaker); send them; Family Calendar `get_events {from,to}` (new, minimal) read path.
7. **Acceptance**: both evals pass on held-out homes → then WhatsApp sim batch (two stacks) → owner reads two real weeks.

## Working rules (owner)
- Plan before build: show breakdown, wait for go. No PR before the owner tests. Never push unless asked.
- Never run the full Flock server suite; single test files with a private `TMUX_TMPDIR` and `env -u FLOCK_HOME -u DATA_DIR`. Planner suite (`bun test server/ src/`) is fine.
- `git -C <repo>`, add files by path, never `-a`. Commit trailer: Co-Authored-By + Claude-Session lines.
- Don't touch owner instances (35626, 35850); only stop other stacks when the owner says so. Sim: load `~/.flock-wa-onboarding-test/sim/current.env` first; ≤2 stacks.
- Live gateway maps fast/balanced/best all to `deepseek/deepseek-v4-flash` (FWS DB routes, not the config file). OpenRouter key has a daily limit (owner raised it 23 Nov); never print keys.
- Evals: tune on h1–h8, score on fresh chats; no test-family names in any model-facing text.
