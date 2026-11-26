# One Meaning Model — Meal Planner Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Meal Planner decide what each family word means once, at setup (templates, typed rule targets, per-person versions), and have the planner read only that — no name re-matching, no fail-closed unknowns — with the manifest's new meal questions, a migration for saved installs, and evals that catch the walk-through failures.

**Architecture:** Templates become the only store of meaning (kind parts carry the family's `words` and an optional `dish`; a new linked part copies another meal's item). Rules carry typed `targets` / `gives` resolved at write time (setup, `set_rule`, migration) by one resolver; planning checks kind/sub/item targets against saved places and ingredient targets against facts, and turns every unknown into a question. The library holds dishes only (history). A boot-time, run-once migration rewrites saved setups into these shapes.

**Tech Stack:** Bun + TypeScript, Hono, Drizzle (bun:sqlite) through `@flock/app-kit` (additive schema sync at boot), `bun test`.

**Spec:** `apps/planner/docs/2026-11-26-one-meaning-model-design.md` (read §5, §6, §7, §9, §10 before any task). Worktree: `/Users/shivashankar/Developer/mp-onb2-planner`, branch `fix/planner-onboarding-run`. All paths below are relative to `apps/planner` unless they start with `/`.

## Global Constraints

- Tests: `bun test <one file>` from `apps/planner`, **one file at a time**. Never the full suite, never `bun test` with no file, never `bun test evals/` (laptop crash).
- Type check: `bunx tsc --noEmit 2>&1 | grep -c "error TS"` from `apps/planner`. Record the count before Task 1 (~62 pre-existing). Every task ends with "no new errors" (count ≤ baseline), never "zero".
- Commits: `git -C /Users/shivashankar/Developer/mp-onb2-planner add <files>` then `git -C /Users/shivashankar/Developer/mp-onb2-planner commit`; never `commit -a`; check `git -C … log -1` shows the commit. No push, no PR (no PR before the owner tests).
- Schema: additive only. `@flock/app-kit` blocks a drop-column on a table with rows (`migrate.ts` `planDestructive`), so `slots.kinds` stays as a column, is nulled by the migration, and is never read or written again.
- Planning never matches a family word to the catalog: `matchDish`, `regionalWordOf`, `isCategoryName`, `categoryPlace` are not called from `fillWeek.ts`, `planChecks.ts`, `planDays.ts`, `makePlan.ts`. Exact catalog item lookups by an item's own name (`catalogItem`, `catalogKind`, `plannerTags`) stay allowed. Word resolution happens only in `setup.ts`, `targets.ts` (rule writes) and `migrateMeaning.ts`.
- Owner rules in force: ≥30% of non-staple items the family's own (`OWN_SHARE = 0.3`), no new kinds unless asked, a variant repeats only when all are used, never the next day, one question per weekly message.
- Unknown = plan and ask, for every rule incl. allergies; no rule fails closed (§5.2). "Nobody without food" fills only a known break.
- Question copy (exact, §9.1): named check `is the <dish> OK for <person>, no <ingredient>`; at most 3 named, allergy ones first; the rest `<n> more to check on the week page`.
- A category word is never a library row (§5.3); `setup_state.places` is never read by planning (§5.1).
- Manifest contract (§10) is fixed: question ids, facts, `when`s and placeholders exactly as listed there. Question wordings in Task 11 are drafts: show the owner the list of `ask`/`recall` texts before building Task 11 (§11), and change only wording on their reply.
- Cross-lane (§6.3b): Flock sends `household.mealsBy`, `household.groceriesBy`, `household.schoolBy` as lists `[{ person, part? }]`, never text. Nothing in `server/` or `src/` reads them today (checked 26 Nov: no reader); keep it so — any new reader takes the list shape. `flock.app.json` keeps them in its household facts list (l.163-164) and `connectLater`'s `when: "!groceryApps and household.groceriesBy"` (l.637) is unchanged (a non-empty list is filled in Flock's `facts.ts`).
- Every eval household's `household.people` holds the speaker with `relation: "self"` exactly once (true for all 17 today; h18 too).
- The catalog's `bare` list is drafted by the builder and reviewed by the owner (§5.1): Task 1 ships the draft and a review copy; only the values the spec names are fixed (Dosa → "Plain dosa"; Upma, Sabzi, Gravy, Rice curry → null).

## Review Focus

1. **A linked part whose source meal is not cooked that day** (Sunday dinner ordered in, a box linked to Lunch on a day Lunch is eaten out): the box must still get a real item of that kind, chosen on its own (§5.4). Test in Task 9.
2. **An install upgraded with saved weeks and old category rows** (planner 4.1.x: library rows "Dry sabji", rules `items: ["salad"]`, `slots.kinds` set): boot must migrate once, a second boot must change nothing, and `make_plan` must still plan. Test in Task 4.
3. **A rule word no catalog place and no tag knows** ("no maida"): it becomes an ingredient target; non-catalog family dishes are unknown for it and asked about (≤3 named), never dropped for that person across the week. Test in Task 7.
4. **A box person away for the day** (a calendar "school trip" for Agastya): the box slot-day is not planned and nobody is taken off the main meal for it. Test in Task 5.
5. **A swap whose `gives` item the family disliked or dropped** (Pancakes `disliked`): the swap item is still a planned dish for that person (a swap is their word), never silently nothing; a `gives` kind with no family item picks a catalog item and counts as new. Test in Task 9.

---

## File map

| File | Change |
|---|---|
| `scripts/kinds/gen-kinds.js`, `server/kinds.json`, `scripts/kinds/bare-draft.md` (new) | `bare` per kind and sub-kind; owner review copy |
| `server/kinds.ts` | new part shapes, `MealTemplate.days`, `bareDish`, `checkMealShape(templates, ctx)`, `mealKinds` (derived, not stored); `MealKind` no longer stored |
| `server/targets.ts` (new) | `RuleTarget`, `resolveTarget`, `resolveGives`, `targetsOf`, `hitsTarget`, `targetText` |
| `server/db/schema.ts` | `slots.extras`, `rules.targets`, `rules.gives`, `slot_dishes.for_people`, `house.meaning_model_at`; `slots.kinds` comment "retired" |
| `server/slotStore.ts` | `Slot` without `kinds`, with `extras`; `Rule.targets/gives`; `SlotDish.for_people`; writes |
| `server/migrateMeaning.ts` (new), `server/index.ts` | run-once boot migration |
| `server/planDays.ts` | `replacedMeal`, box attendance (§5.4) |
| `server/planChecks.ts`, `server/allergy.ts` | typed target checks, `ruleUnknowns`, careful read removed |
| `server/fillWeek.ts` | pools from templates + history; dish/words parts; linked parts; swap items; extras add-ons; visit cap |
| `server/makePlan.ts`, `server/messages.ts` | careful read removed; unknowns into `planQuestion`; `for_people` saved; over-limit notes |
| `server/changes.ts`, `server/agentOps.ts`, `server/agent-guide.md` | `set_rule` resolves targets; `record_feedback` answers `fits` / `not_for` |
| `server/setup.ts` | reads into the new shapes; read-back in the family's words |
| `flock.app.json`, `server/manifest.test.ts` | §6.1 questions per the §10 contract |
| `evals/lib/truth.ts`, `evals/lib/score-plan.ts`, `evals/lib/score-setup.ts`, `evals/lib/interview.ts`, `evals/lib/adapter.ts`, `evals/households/*`, `evals/eval-e2e.ts` | new shapes, new checks, h18 |

## Task order and parallelism

```
T1 catalog bare ─────────────┐
T2 shapes + storage ─┬─ T3 targets ─┬─ T4 migration
                     │              ├─ T7 checks ── T8 fill: meaning ── T9 fill: versions+cap ── T10 makePlan/messages/feedback
                     ├─ T5 attendance (parallel with T3)
                     └─ T12 setup (after T3; parallel with T7–T10)
T11 manifest ─────────────── (independent from the start)
T13 eval scorer+truth types (after T2; parallel) ── T14 households+h18 (after T11, T13) ── T15 e2e run (after all)
```

Independent, can run in parallel worktrees: **T1, T2, T11** at the start; after T2: **T3, T5, T13**; after T3: **T4, T7, T12**.

---

### Task 1: Catalog `bare` field

**Files:**
- Modify: `scripts/kinds/gen-kinds.js` (a `BARE` table applied before writing; output fields `bare` on each kind and sub-kind)
- Regenerate: `server/kinds.json`, `docs/kinds-catalog.md` (its review copy, as the generator already writes)
- Create: `scripts/kinds/bare-draft.md` (one line per kind/sub-kind: name → bare dish or "category", with a one-phrase reason; owner review copy)
- Modify: `server/kinds.ts` (types + `bareDish`)
- Test: `server/kinds.test.ts`

**Interfaces:**
- Produces: `CatalogKind.bare: string | null`, `CatalogSub.bare: string | null`; `bareDish(kind: string, sub?: string | null): string | null` — the sub-kind's `bare` when a sub is given and has one, else the kind's; null for a staple kind (staples keep `contentsItem`'s everyday item) and for an unknown kind.

- [ ] **Step 1: Write the failing tests** in `server/kinds.test.ts`, `describe("bare words")`:
  - `it("a bare dosa is Plain dosa; upma, sabzi, gravy and rice curry are categories")`: `expect(bareDish("Dosa")).toBe("Plain dosa")`; `expect(bareDish("Upma")).toBeNull()`; `expect(bareDish("Sabzi")).toBeNull()`; `expect(bareDish("Gravy")).toBeNull()`; `expect(bareDish("Rice curry", "Sambar")).toBeNull()`.
  - `it("every bare dish is an item of its own kind (and sub-kind)")`: for every kind/sub with `bare`, `catalogItem(bare)!.kind.name === kind.name` and, for a sub, `catalogItem(bare)!.item.sub === sub.name`.
  - `it("staples have no bare dish")`: every `k.staple` kind has `bare === null`.
- [ ] **Step 2: Run** `bun test server/kinds.test.ts` — expect FAIL (`bareDish` not exported).
- [ ] **Step 3: Implement.** Draft `BARE` in the generator: the spec's fixed values plus the builder's draft for every other non-staple kind (rule for the draft: a bare word means one dish only where families say the kind's name for its one plain everyday item — Idli → "Idli", Dosa → "Plain dosa"; kinds whose word covers many everyday dishes are categories: Upma, Poha, Sabzi, Gravy, Dal, Rice curry, Salad); lead's call, owner to confirm: Paratha → "Plain paratha" (Dad's parathas and the lunch-box roll are plain parathas; stuffed ones are their own items). Write `bare-draft.md` listing each with "fixed by spec" or "draft". Add types and `bareDish` to `kinds.ts`.
- [ ] **Step 4: Run** `node scripts/kinds/gen-kinds.js` then `bun test server/kinds.test.ts` — PASS. Type check: no new errors.
- [ ] **Step 5: Commit** `feat(catalog): a bare word's dish per kind and sub-kind (draft for owner review)`.

---

### Task 2: Template part shapes and storage

**Files:**
- Modify: `server/kinds.ts:120-170` (types, `checkMealShape`), add `mealKinds`
- Modify: `server/db/schema.ts` (slots, rules, slot_dishes, house), `server/slotStore.ts`
- Test: `server/kinds.test.ts`, `server/slotStore.test.ts`, `server/schema.test.ts`

**Interfaces:**
- Produces (kinds.ts):
  ```ts
  export type KindPart = { kind: string; sub?: string; words?: string; dish?: string };
  export type ItemsPart = { items: string[] };
  /** Linked (§5.1): the item `from` has for `kind` (and `sub`) that day; no kind = the whole plate of `from`. */
  export type LinkedPart = { from: string; kind?: string; sub?: string };
  export type TemplatePart = KindPart | ItemsPart | LinkedPart;
  export type MealTemplate = { parts: TemplatePart[]; share?: Frequency | null; said?: string | null; days?: Weekday[] | null };
  export const isItemsPart: (p: TemplatePart) => p is ItemsPart;
  export const isLinkedPart: (p: TemplatePart) => p is LinkedPart;
  export const isKindPart: (p: TemplatePart) => p is KindPart;
  export function checkMealShape(templates: readonly MealTemplate[], ctx: { slot: string; slots: readonly string[] }): string[];
  /** Derived each run from the templates, never stored: staple from the catalog, own = not a catalog kind, subs = the parts' subs. */
  export function mealKinds(templates: readonly MealTemplate[]): MealKind[];
  ```
- Produces (slotStore.ts): `Slot` = today's minus `kinds`, plus `extras: boolean` (an add-on beside the main plate: its people stay counted and fed at the main meal); `SlotInput.extras?: boolean`, `SlotInput.kinds` removed; `Rule.targets: RuleTarget[] | null`, `Rule.gives: RuleTarget | null` (type imported from `targets.ts`, created in Task 3 — in this task declare `RuleTarget` in `targets.ts` as the type only); `SlotDish.for_people: string[]`, `SlotDishInput.for_people?: string[]`.
- Schema columns: `slots.extras integer default 0`; `rules.targets text` (JSON RuleTarget[]), `rules.gives text` (JSON RuleTarget); `slot_dishes.for_people text` (JSON string[]: a dish only for these people, a swap's item; null = the slot-day's people); `house.meaning_model_at text` (the migration's marker). `slots.kinds` comment becomes "retired (one meaning model): nulled by migrateMeaning, never read".

- [ ] **Step 1: Write the failing tests.**
  - `kinds.test.ts` `it("a kind part may carry the family's words and a dish of that kind")`: `checkMealShape([{ parts: [{ kind: "Dosa", dish: "Plain dosa", words: "dosa" }] }], ctx)` → `[]`; `{ kind: "Dosa", dish: "Rava upma" }` → one error containing `"Rava upma is not a Dosa"`.
  - `it("a linked part names another meal of the house, never its own")`: ctx `{ slot: "Agastya's lunch box", slots: ["Breakfast", "Lunch", "Dinner", "Agastya's lunch box"] }`; `{ from: "Lunch", kind: "Sabzi" }` → `[]`; `{ from: "Snack" }` → error containing `"Snack is not a meal"`; `{ from: "Agastya's lunch box" }` → error containing `"links to itself"`.
  - `it("a whole-plate link is the template's only part")`: `[{ parts: [{ from: "Breakfast" }, { items: ["Fruit"] }] }]` → error containing `"whole plate"`.
  - `it("a kind no catalog has is the family's own kind; a sub-kind must be the kind's")`: `{ kind: "Pancakes" }` → `[]`; `{ kind: "Sabzi", sub: "Sambar" }` → error.
  - `it("the kinds a meal has are those its templates name")`: `mealKinds([{ parts: [{ kind: "Rice" }, { kind: "Rice curry", sub: "Sambar" }, { from: "Lunch", kind: "Sabzi" }] }])` → `[{ name: "Rice", staple: true }, { name: "Rice curry", subs: ["Sambar"] }]` (a linked part's kind is not the meal's own).
  - `slotStore.test.ts` `it("a slot stores templates of every part shape and an extras flag; no kinds")`: upsert `{ name: "Shiva's lunch box", kind: "addon", addon_of: "Lunch", order: 60, extras: true, templates: [{ parts: [{ items: ["4 boiled eggs"] }, { kind: "Salad", words: "salad" }], days: ["Mon","Tue","Wed","Thu","Fri"] }] }`; read back equal; `"kinds" in slot` is false.
  - `it("a rule keeps its typed targets and what it gives; a slot dish who it is for")`.
  - `schema.test.ts`: the four new columns exist; `slots.kinds` still exists.
- [ ] **Step 2: Run** each file (`bun test server/kinds.test.ts`, then `server/slotStore.test.ts`, then `server/schema.test.ts`) — FAIL.
- [ ] **Step 3: Implement.** `checkMealShape` errors, one line each, exact fragments: `"<dish> is not a <kind>"`, `"<from> is not a meal of this house"`, `"<slot> links to itself"`, `"a whole plate link is the template's only part"`, plus today's share / sub-kind / empty-items lines. `upsertSlot` calls `checkMealShape(templates, { slot: s.name, slots: listSlots(tx, { all: true }).map(x => x.name).concat(s.name) })`. `slotOf` ignores `r.kinds`. Callers of `Slot.kinds` will break to compile: leave `fillWeek.ts`/`setup.ts` call sites compiling by switching them to `mealKinds(s.templates ?? [])` (no behaviour change yet).
- [ ] **Step 4: Run** the three files — PASS. Then `bun test server/fillWeek.test.ts` and `bun test server/setup.test.ts` — same pass/fail as before this task (record failures that pre-exist). Type check: no new errors.
- [ ] **Step 5: Commit** `feat(planner): template part shapes (words, dish, linked), typed rule columns, extras add-ons`.

---

### Task 3: Rule targets resolver

**Files:**
- Create: `server/targets.ts`, `server/targets.test.ts`
- Modify: `server/changes.ts` (`set_rule` write path ~l.300-340), `server/allergy.ts`

**Interfaces:**
- Consumes: `matchDish`, `bareDish`, `catalogKind` (kinds.ts); `BASE_TAGS`, `TAG_PARENT` (db/constants); `CATALOG.tags`.
- Produces:
  ```ts
  export type RuleTarget = { type: "kind"; kind: string } | { type: "sub"; kind: string; sub: string }
    | { type: "item"; item: string; kind: string | null } | { type: "ingredient"; tag: string };
  /** A rule word to its one target: a known tag (BASE_TAGS, TAG_PARENT keys/values, catalog tags, singular of a plural) → ingredient;
   *  else matchDish: item → item, sub → sub, kind → kind; else an ingredient of that word (canonTag). */
  export function resolveTarget(word: string): RuleTarget;
  /** A swap's `to`: as resolveTarget, except a kind word whose bareDish exists gives that item; a word the catalog does not know
   *  is the family's own item (kind null). Never an ingredient. */
  export function resolveGives(word: string): Exclude<RuleTarget, { type: "ingredient" }>;
  /** A rule's targets as saved, else derived from what/items (veg → meat, fish + items; no_eggs → egg + items; egg → items or meat, fish). */
  export function targetsOf(r: Pick<Rule, "what" | "items" | "targets">): RuleTarget[];
  export type DishPlace = { kind: string | null; sub: string | null; item: string | null };
  /** true/false for a kind, sub or item target against a dish's saved place; null for an ingredient target (facts decide). */
  export function hitsTarget(t: RuleTarget, p: DishPlace): boolean | null;
  /** The target in the family's words for read-back and questions: "egg", "salad", "upma", "Pancakes". */
  export function targetText(t: RuleTarget): string;
  ```
- `isAllergyRule` (allergy.ts) reads `targetsOf(r)` and needs ≥1 ingredient target (was `items.length`).

- [ ] **Step 1: Write the failing tests** in `server/targets.test.ts`:
  - `it("tags are ingredients, dish words land on the catalog")`: `resolveTarget("egg")` → `{ type: "ingredient", tag: "egg" }`; `"eggs"` → same; `"salad"` → `{ type: "kind", kind: "Salad" }`; `"upma"` → `{ type: "kind", kind: "Upma" }`; `"rava upma"` → `{ type: "item", item: "Rava upma", kind: "Upma" }`; `"sambar"` → `{ type: "sub", kind: "Rice curry", sub: "Sambar" }`; `"maida"` → `{ type: "ingredient", tag: "maida" }`.
  - `it("a swap gives an item or a kind, never an ingredient")`: `resolveGives("pancakes")` → `{ type: "item", item: "Pancakes", kind: null }` (title-cased family word); `resolveGives("dosa")` → `{ type: "item", item: "Plain dosa", kind: "Dosa" }`; `resolveGives("upma")` → `{ type: "kind", kind: "Upma" }`.
  - `it("a kind target holds for every item of the kind, read from the saved place")`: `hitsTarget({ type: "kind", kind: "Upma" }, { kind: "Upma", sub: "Upma", item: "Rava upma" })` → true; against Poha place → false; ingredient target → null.
  - `it("veg is meat and fish")`: `targetsOf({ what: "veg", items: null, targets: null })` → ingredients meat, fish.
  - `changes.test.ts` `it("set_rule saves typed targets from the agent's items and to")`: `set_rule { hard: true, what: "swap", who: "Agastya", items: ["upma"], to: "pancakes", quote: "pancakes when it's upma" }` → saved `targets: [{ type: "kind", kind: "Upma" }]`, `gives: { type: "item", item: "Pancakes", kind: null }`.
- [ ] **Step 2: Run** `bun test server/targets.test.ts` — FAIL; then `bun test server/changes.test.ts` — the new test FAILs.
- [ ] **Step 3: Implement** `targets.ts`; in `changes.ts` `set_rule` write `targets: items?.map(resolveTarget)`, `gives: to ? resolveGives(to) : null` (soft swap with a frequency keeps `to` text and `gives` null, §9.4: "millets sometimes" stays its own kind); `allergy.ts` as above.
- [ ] **Step 4: Run** both files — PASS. `bun test server/rules.test.ts` unchanged. Type check: no new errors.
- [ ] **Step 5: Commit** `feat(rules): typed rule targets, resolved once when a rule is written`.

---

### Task 4: Migration of saved installs

**Files:**
- Create: `server/migrateMeaning.ts`, `server/migrateMeaning.test.ts`
- Modify: `server/index.ts` (call after `moveRegulars`, inside `kit.status.state === "ok"`, in its own try/catch with a `console.warn`)
- Move into `migrateMeaning.ts` (out of `fillWeek.ts`): `deriveTemplates` and a private copy of the old `isCategoryName` / `categoryPlace` (the only place left that re-reads saved words, once).

**Interfaces:**
- Consumes: `resolveTarget`, `resolveGives` (Task 3); `bareDish` (Task 1); slotStore reads/writes; `checkMealShape`.
- Produces: `export function migrateMeaning(sqlite: Database, db: Db, now?: Date): "migrated" | "none" | "already"` — marker `house.meaning_model_at`.

Mapping (decides §11 "the migration's exact mapping"):
1. A slot with `templates` null and history or library rows: templates from `deriveTemplates` (as today's planner did each run), saved once.
2. Each library row whose name the old `isCategoryName` calls a category, at a slot: every kind part of that slot's templates with the same kind (and sub when the word named one) gets `words` = the row's name lower-cased (joined with " or " when a part already has words). The row's `days` go on each template holding that part as `days`; its `frequency` on the template as `share` when the template has none; its `said` as `said`. Then the row is deleted. A category row whose kind no template holds: deleted, logged `migrate: <slot>: <word> held by no template, dropped`.
3. A kind part whose words name exactly one bare dish (`bareDish(kind, sub)` and the words equal the kind's name or an aka) gets `dish`.
4. Each rule with `targets` null: `targets = items.map(resolveTarget)` (plus `targetsOf`'s derived ones for veg/egg/no_eggs); a hard swap with `to`: `gives = resolveGives(to)`.
5. `slots.kinds` set to null on every slot.
6. `setup_state.places` left untouched.

- [ ] **Step 1: Write the failing tests** (use `server/testkit.ts` `boot` with a temp dir; write 4.1.x rows directly):
  - `it("a category row becomes its template part's words and leaves the library")`: Lunch templates `[{ parts: [{ kind: "Rice" }, { kind: "Sabzi" }] }]`, library row "Dry sabji" (kind Sabzi) at Lunch, row "Aloo gobi" (kind Sabzi, catalog_item "Aloo gobi"). After: part `{ kind: "Sabzi", words: "dry sabji" }`; library has "Aloo gobi", not "Dry sabji".
  - `it("a category kept to a day moves its days onto the template")`: "Pongal" category row `days: ["Sun"]` → the template holding Pongal has `days: ["Sun"]`.
  - `it("old tag rules naming a kind get kind targets; tags stay ingredients")`: rule avoid `items: ["salad", "egg"]` → targets `[kind Salad, ingredient egg]`; swap items `["upma"]` to `"pancakes"` → gives item Pancakes.
  - `it("slots.kinds is cleared; a slot without templates gets them once")`.
  - `it("runs once: a second boot changes nothing")`: second call → `"already"`, rows identical.
  - `it("a migrated install still plans")`: after migration, `makePlan` with a fake model returning empty ingredients → `ok: true` and no dish named "Dry sabji".
- [ ] **Step 2: Run** `bun test server/migrateMeaning.test.ts` — FAIL.
- [ ] **Step 3: Implement** in one `commit(db, emit, …)` transaction; marker set last.
- [ ] **Step 4: Run** `bun test server/migrateMeaning.test.ts` — PASS; `bun test server/fillWeek.test.ts` — same as before (deriveTemplates tests move into `migrateMeaning.test.ts`). Type check: no new errors.
- [ ] **Step 5: Commit** `feat(planner): migrate saved setups to the one meaning model, once`.

---

### Task 5: Attendance — only a box that replaces a meal takes its person off it

**Files:**
- Modify: `server/planDays.ts:256-287` (`buildDays`)
- Create: `server/planDays.test.ts`

**Interfaces:**
- Consumes: `INSTEAD_STEP`, `SLOT_ORDER` (constants); `Slot.extras` (Task 2).
- Produces: `export function replacedMeal(s: Pick<Slot, "kind" | "order" | "usual_people">, slots: Slot[]): Slot | null` — the main slot with `order + INSTEAD_STEP === s.order` when `s` is custom with named people; else null.

Rules (§5.4): a custom slot whose `replacedMeal` is M takes its people off M on the days it runs (its `days`, and only when that person is at the box that day); no other custom slot takes anyone off any meal (delete the l.265 rule "any custom slot of the person removes them from Lunch"); an add-on never takes anyone off; `carries` keeps the person at Lunch (unchanged `awayBy`).

- [ ] **Step 1: Write the failing tests** (pure `buildDays` with h18-like slots: Breakfast 10, Lunch 30, Dinner 50, "Agastya's breakfast box" custom 15 Mon–Fri `[Agastya]`, "Agastya's lunch box" custom 35 Mon–Fri `[Agastya]`, "Shiva's lunch box" addon of Lunch, extras; people Shiva, Ankita, Agastya, Gowri Shankar; weekly Ankita office Mon–Fri 09:00–16:00 lunch away, Agastya school Mon–Fri 07:20–15:00; weekday lunch Shiva `carries`):
  - `it("a lunch box takes its child off Lunch on box days only")`: Mon Lunch people `["Shiva", "Gowri Shankar"]`; Sat Lunch has all four.
  - `it("a breakfast box takes its child off Breakfast, never off Lunch")`: Mon Breakfast lacks Agastya; with the lunch box removed from slots, Mon Lunch keeps Agastya only if weekly does not make him away (assert the breakfast box alone removes nothing from Lunch).
  - `it("an extras add-on keeps its person at the main meal")`: Mon Lunch includes Shiva and "Shiva's lunch box" Mon has `["Shiva"]`.
  - `it("a box person away that day: no box slot-day and nobody taken off")` (Review Focus 4): an `Attendance` change `{ effect: "away", people: ["Agastya"], dates: [Mon], why: "school trip" }` → no Mon "Agastya's lunch box" day; Mon Lunch does not list Agastya and its `why` has no "has their own box".
- [ ] **Step 2: Run** `bun test server/planDays.test.ts` — FAIL.
- [ ] **Step 3: Implement** `replacedMeal`; in `buildDays` replace the l.263-268 branch with: for a main slot M, drop each person p for whom some active custom slot B with `replacedMeal(B) === M`, `B.days` holding the day, p in `B.usual_people`, and p not away that day by `o.changes`; why `"<p>: has <B.name> on <day>"`. Box people's own away changes are applied to the box slot (already, via `o.changes`).
- [ ] **Step 4: Run** `bun test server/planDays.test.ts` — PASS; `bun test server/makePlan.test.ts` — record and fix only failures this change causes (tests that asserted the old any-custom-slot rule get the new expectation). Type check: no new errors.
- [ ] **Step 5: Commit** `fix(planDays): only a box that replaces a meal takes its person off it`.

---


### Task 7: Rule checks on typed targets; unknown = ask

**Files:**
- Modify: `server/planChecks.ts` (`forbidden`, `ruleBreaks`, `notFor`, `leaveOutNotes`, `swapNotes`, `softSwapNotes`, `Week`), `server/allergy.ts`
- Test: `server/planChecks.test.ts`

**Interfaces:**
- Consumes: `targetsOf`, `hitsTarget`, `DishPlace` (Task 3).
- Produces:
  ```ts
  // Week: `careful` removed; `places?: Map<string, DishPlace>` (by dish key: what the fill placed each dish as)
  export function placeOfDish(w: Week, slot: string, dish: string): DishPlace; // w.places, else the library row's kind/sub/catalog_item, else catalogItem(dish) exact, else all null
  export function forbidden(r: Rule): string[];            // the ingredient tags of targetsOf(r) for veg/egg/no_eggs/avoid/swap/only (as today's cases)
  export type Unknown = { dish: string; who: string; tag: string; quote: string; allergy: boolean; date: string; slot: string };
  export function ruleUnknowns(w: Week, d: PlanDay, dish: string): Unknown[]; // ingredient targets the dish was never read for, per person at d
  export function swapsAt(w: Week, d: PlanDay, dish: string): { who: string; gives: RuleTarget; quote: string }[]; // hard swaps whose targets the dish hits, for people at d
  ```
- `ruleBreaks` keeps its signature: a kind/sub/item target hit by `placeOfDish` is a break (`"<dish> is <targetText>: against <p>'s rule \"<quote>\""`); an ingredient target is a break only when the dish's facts have it (main ingredient; leave-out ingredients stay notes); **not read is no break** (it is `ruleUnknowns`'). Swap rules never break (their person gets the swap item, Task 9). `carefulTags`, `Week.careful` and the careful branch go; `vouched` stays (a family dish under an allergy needs no ask).

- [ ] **Step 1: Write the failing tests** (`describe("one meaning model checks")`):
  - `it("a kind target breaks every item of the kind by its saved place")`: rule GS avoid `targets [kind Salad]`; `w.places` has "Cucumber salad" → Salad; `notFor(w, day(GS), "Cucumber salad")` → `["Gowri Shankar"]`; `"Aloo gobi"` → `[]`.
  - `it("a dish never read for an ingredient is planned and asked, never kept from the person")`: library "Kadhi" (own dish, `contains_read: []`), rule GS avoid egg: `notFor` → `[]`; `ruleUnknowns` → `[{ dish: "Kadhi", who: "Gowri Shankar", tag: "egg", allergy: false, … }]`.
  - `it("an allergy unknown is asked too, flagged as an allergy")`: rule Agastya avoid peanut quote "allergic to peanuts": unknown with `allergy: true`; `notFor` → `[]`.
  - `it("a family dish under an allergy is vouched: no break, no ask")`.
  - `it("a known egg dish is not for the person who eats no egg")`: "Egg curry" (catalog) → `notFor` `["Gowri Shankar"]`, no unknowns.
  - `it("a swap never breaks; it names who gets what")`: Agastya swap `[kind Upma]` gives item Pancakes; `notFor(…, "Rava upma")` → `[]`; `swapsAt` → `[{ who: "Agastya", gives: { type: "item", item: "Pancakes", kind: null }, … }]`.
- [ ] **Step 2: Run** `bun test server/planChecks.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Delete fail-closed lines and the careful branch; `forbidden` via `targetsOf`.
- [ ] **Step 4: Run** `bun test server/planChecks.test.ts` — PASS (tests that asserted fail-closed or careful behaviour are rewritten to the ask behaviour, each with a comment `// one meaning model: unknown = ask`). Type check: no new errors (makePlan's careful code is removed in Task 10; until then keep it compiling by leaving `careful` optional and unused).
- [ ] **Step 5: Commit** `feat(planChecks): rules checked by typed target; an unknown is asked, never a block`.

---

### Task 8: Fill — templates are the only meaning; library is history

**Files:**
- Modify: `server/fillWeek.ts` (pools, staples, limits, template choice)
- Test: `server/fillWeek.test.ts`

**Interfaces:**
- Consumes: `KindPart`, `mealKinds`, `bareDish` (kinds.ts); `placeOfDish`, `Week.places` (Task 7).
- Produces: `FillInput` without `careful`, `strict`; `FillResult` without `provisional`, with `unknowns: Unknown[]` and `places: Map<string, DishPlace>` (every item placed, by dish key: its kind, sub, catalog item); `placeOf(row)` reads `row.kind/sub` only; `catalogNameOf(row)` is `row.catalog_item`. Removed exports: `isCategoryName`, `deriveTemplates` (moved, Task 4).

Pool rules per kind part `{ kind, sub?, words?, dish? }` at slot S (§5.1):
- **family pool** = library rows at S with that kind (and sub when given), not disliked/dropped (history and named dishes), then — when the part has no `dish` — the catalog items of the kind/sub (`suggestable`, family cuisines) counted as the family's own (`family: true, catalog: true`), those whose words contain every word of `words` first (their "upma" is an upma). When the part has `dish`: that dish (a family item, even with no library row) first; other catalog items of the kind are **new**.
- **new pool** = catalog items of the kind/sub outside the family pool; a part with `words` keeps new items inside its sub-kind ("etc." rule); an own kind (no catalog kind) and a staple give none.
- A staple part: the family's usual item = most-had library row of that kind at S, else any row of that kind, else `catalogKind(kind).items[0].name` (no `matchDish` on plate names).
- The family's limits come from the template (`share`, `days`, `said`) and from named-dish library rows (`frequency`, `days`); the category-row limit code (`catRowsAt`, `catDays`, `namedAt`, `categoriesAt`, `categoryPlace`) goes. A template with `days` is assigned only on those weekdays.
- A slot with no templates plans nothing (log `"<slot>: no templates"`); makePlan's `known()` already asks about it.
- Every placed item's place goes into `res.places` and `w.places`.
- `feed()` (a person with nothing) runs only for `notFor` (a known break); unknowns are collected into `res.unknowns` via `ruleUnknowns` for each placed dish and person.

- [ ] **Step 1: Write the failing tests** (`describe("one meaning model fill")`, inputs built in-test; no matchDish-able names needed):
  - `it("a category part is filled with catalog items of its kind, never the family's word")`: Lunch `[{ kind: "Rice" }, { kind: "Sabzi", words: "dry sabji" }]`, library empty → every Lunch plate's second dish is a catalog Sabzi item (`catalogItem(name)!.kind.name === "Sabzi"`), none named "Dry sabji"; those items count as the family's own (`placed` is empty).
  - `it("a part with a dish places that dish first; other items of the kind are new")`: Breakfast `[{ kind: "Dosa", dish: "Plain dosa", words: "dosa" }]` only template, 7 days: day 1 is "Plain dosa"; any other Dosa item is in `res.placed`.
  - `it("the family's words for a category pick its items first")`: Breakfast `[{ kind: "Upma", words: "upma" }]` → first item's name contains "upma".
  - `it("a template kept to days comes only on those days")`: `[{ parts: [{ items: ["Bread omelette"] }], days: ["Sun"] }]` beside `[{ kind: "Idli" }]` → Bread omelette only on Sunday.
  - `it("one unknown never spreads: the person keeps the plate, the dish is asked once")` (anti-goal R3): GS avoid ingredient egg; library "Kadhi" unread, Lunch `[Rice, {kind:"Rice curry", sub:"Kadhi"}]`… → no plate gets an extra filler dish for GS; `res.unknowns` holds Kadhi/GS once per placement; `res.log` has no "nothing of its template".
  - `it("never matches a family word")`: spy — `fillWeek.ts` source does not contain `matchDish(`, `regionalWordOf(`, `isCategoryName(` (read the file text in the test).
- [ ] **Step 2: Run** `bun test server/fillWeek.test.ts` — new tests FAIL.
- [ ] **Step 3: Implement** the pool rules above. Old tests that fed category library rows ("Dal", "a poriyal") are rewritten to template parts with `words`; tests of `deriveTemplates` moved in Task 4.
- [ ] **Step 4: Run** `bun test server/fillWeek.test.ts` — PASS. Type check: no new errors.
- [ ] **Step 5: Commit** `feat(fillWeek): fill from templates and history only; no word is matched again`.

---

### Task 9: Fill — per-person versions and the cook's visit limit


**Files:**
- Modify: `server/fillWeek.ts`
- Test: `server/fillWeek.test.ts`

**Interfaces:**
- Consumes: `LinkedPart`, `swapsAt` (Task 7), `Slot.extras` (Task 2), `replacedMeal` (Task 5).
- Produces: `FilledDish` gains `for_people: string[]` (empty = the slot-day's people) and `linked: boolean`; `FillInput.visits?: Visit[]` with
  ```ts
  export type Visit = { cook: string | null; meals: string[]; days: Weekday[]; cap: number; label: string }; // label: "breakfast and lunch"
  ```
  `FillResult.unmet` gains over-limit lines.

Rules:
- **Order**: on each date, a slot with a linked part is filled after the slot it links to (sort `todo` by date, then a dependency-aware slot order; ties by `order`).
- **Linked part** `{ from, kind?, sub? }`: the source slot-day's plate item of that kind (and sub) that day, same name, `linked: true`; whole plate (no kind) = every dish of the source plate, `linked: true`. Source not cooked that day (no slot-day, skipped, or no item of that kind): the part is filled as a kind part `{ kind, sub }` on its own (whole plate: the source slot's templates) — Review Focus 1. Linked dishes are not `use()`d (no repeat counting), not counted in `OWN_SHARE` places or new counts, and counted once for the cook.
- **Swap item**: for each placed dish and each person at the slot-day with a `swapsAt` entry, place the `gives` dish on the same plate with `for_people: [person]` (an item: that item, even if disliked — Review Focus 5; a kind: the family's least-recent item of that kind, else a catalog item counted as new). In a box slot whose plate is linked, the box gets the swap item in place of the swapped dish (the linked dish is removed from the box for that person's box). The swap item is `use()`d (rotation, never next day) and counted for the cook.
- **Extras add-on** (`slot.extras`): its people stay at the main plate's `atTable`; the add-on plate is its own templates only (no `mainFeeds` logic).
- **Egg/cheese days** (§5.4, builder's call on "wet"): in a slot with a linked part to kind K, a template without any linked part and with `share` is preferred on days the source's K item has sub-kind in a wet set: `WET_SUBS = ["Curry", "Kofta", "Kurma", "Dalna", "Kerala curry", "Paneer"]` (Gravy's sub-kinds) — i.e. when the source Lunch filled its Sabzi part from Gravy or the item's catalog part is a gravy. Read off the source item's saved place, no word matching.
- **Visit cap** (§9.3): for each visit V on a date in `V.days`, count distinct dish keys cooked across V's meals (and boxes/add-ons whose main or link source is in V): each staple counts, a linked dish once, a swap item and a box's own item count. Template choice prefers, per slot-day in V, a template whose part count keeps the visit's running count ≤ `cap` (penalty in the candidate sort after `left`/`allowed`); parts are never dropped. After the fill, a date over the cap adds to `unmet`: `"<Mon> <label>: <n> dishes to cook, more than <cook>'s <cap>"` (cook null → `"the cook's"`).

- [ ] **Step 1: Write the failing tests** (h18-like slots as in Task 5):
  - `it("the lunch box rolls the day's lunch sabzi")`: Agastya's lunch box `[{ items: ["Paratha"] }, { from: "Lunch", kind: "Sabzi" }]` → each Mon–Fri box's second dish equals that day's Lunch Sabzi item, `linked: true`.
  - `it("a linked dish is not a repeat and not counted twice for the cook")`: the Sabzi on Lunch and box is one key in the visit count; `no_early_repeat`-style: its date set has one entry per day.
  - `it("a box whose meal is not cooked that day picks its own item")` (RF1): Lunch `skip_days: [{ day: "Wed", skip: "ordered_in" }]` → Wed box second dish is a Sabzi item, `linked: false`.
  - `it("the breakfast box is the family breakfast, and pancakes on upma days")`: box `[{ from: "Breakfast" }]`, Agastya swap `[kind Upma]` gives item Pancakes; on a Breakfast Upma day the box has "Pancakes" and not the upma; on other days the box equals the Breakfast plate.
  - `it("a swap item is a planned dish for that person")`: Breakfast Upma day plate has `{ name: "Pancakes", for_people: ["Agastya"] }` when Agastya is at Breakfast.
  - `it("a disliked swap item is still given")` (RF5): library Pancakes `disliked: true` → still placed for Agastya.
  - `it("extras ride beside the home lunch")`: Shiva's lunch box (extras) `[{ items: ["4 boiled eggs"] }, { kind: "Salad", words: "salad" }]` Mon–Fri → Mon Lunch plate is fed with Shiva at the table; the add-on plate has "4 boiled eggs" and one Salad item.
  - `it("egg or cheese roll on wet sabzi days")`: Lunch's Sabzi part filled from Gravy on Tue → Tue box uses the sometimes template.
  - `it("the cook's morning is kept to her dishes where a template fits, and said where none does")`: visit `{ meals: ["Breakfast", "Lunch", "Agastya's breakfast box", "Agastya's lunch box"], cap: 4, days: Mon–Sat }` with a 3-part and a 4-part Lunch template → the 3-part one is preferred on days Breakfast has 1 dish; a forced 6 gives unmet `"Mon breakfast and lunch: 6 dishes to cook, more than the cook's 4"`; no part is ever missing.
- [ ] **Step 2: Run** `bun test server/fillWeek.test.ts` — new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test server/fillWeek.test.ts` — PASS. Type check: no new errors.
- [ ] **Step 5: Commit** `feat(fillWeek): linked parts, swap items as planned dishes, extras add-ons, the cook's visit limit`.

---

### Task 10: makePlan, the weekly question, and the answer path

**Files:**
- Modify: `server/makePlan.ts` (remove `CAREFUL_*`, `carefulRead`, `provisional`, `strict`, the second `fill`; build `visits`; save `for_people`; pass `unknowns`), `server/messages.ts` (`planQuestion`), `server/slotStore.ts` (`replaceDishes` writes `for_people`), `server/dishText.ts` (unchanged API: `for_people` maps to `for_people`)
- Modify: `server/changes.ts` (`record_feedback` answers `fits` / `not_for`), `server/agentOps.ts` (`FIELDS.record_feedback` adds `"who"`), `server/agent-guide.md` (line ~106: the plan's check question)
- Test: `server/makePlan.test.ts`, `server/messages.test.ts`, `server/changes.test.ts`

**Interfaces:**
- Consumes: `FillResult.unknowns`, `FilledDish.for_people`, `Visit` (Task 9).
- Produces:
  ```ts
  export type CheckAsk = { dish: string; who: string; tag: string; allergy: boolean };
  export function planQuestion(o: { short: ShortAsk[]; events: EventAsk[]; checks?: CheckAsk[] }): string | null;
  export const CHECKS_NAMED = 3;
  // makePlan.ts
  export function visitsOf(rules: Rule[], cook: { name: string | null; visits: { at: string; meals?: string[] }[] } | null, slots: Slot[]): Visit[];
  ```
- `record_feedback { date, slot, dish, who, answer: "fits" | "not_for" }`: `fits` → the dish's library row at `slot` gets `contains_read += T`, `contains -= T`, where T = ingredient tags of `who`'s hard rules the row was not read for; `not_for` → `contains += T`, `contains_read += T`, then `replan([{ date, slot }])` (the person gets a fed item that day). Either way the dish is never asked again for those tags. `who` is required with these two answers (refuse: `"who is required with answer fits or not_for"`).

Copy (exact): each check `is the <dish> OK for <who>, no <tag words>` (`_` → space); allergy checks first, then by first date; at most `CHECKS_NAMED` named, the rest `"<n> more to check on the week page"`; joined with `andList`; asks order: short meals, checks, events; first letter capitalised, one `?`.

- [ ] **Step 1: Write the failing tests.**
  - `messages.test.ts` `it("plan-and-ask checks: three named, allergies first, the rest counted")`: checks Kadhi/GS/egg, Kootu/GS/egg, Pesarattu/Agastya/peanut allergy, Rasam/GS/egg, Dal/GS/egg → `"Is the Pesarattu OK for Agastya, no peanut, is the Kadhi OK for Gowri Shankar, no egg, is the Kootu OK for Gowri Shankar, no egg and 2 more to check on the week page?"`; one check → `"Is the Kadhi OK for Gowri Shankar, no egg?"`.
  - `makePlan.test.ts` `it("no careful read: one fast ingredients call a day, and unknowns asked in the one question")`: fake model records purposes; none is `"meal plan: what dishes contain, carefully (allergies)"`; `res.asked[0]` contains `"OK for"`.
  - `it("an over-limit morning is said in the plan")`: unmet contains `"dishes to cook, more than"`.
  - `it("a swap item is saved for its person")`: saved slot_dishes row Pancakes `for_people ["Agastya"]`; the message line shows `"Pancakes (for Agastya)"`.
  - `changes.test.ts` `it("a 'fits' answer saves the read and the dish is not asked again")`: after `record_feedback { …, dish: "Kadhi", who: "Gowri Shankar", answer: "fits" }` the Kadhi row has `"egg"` in `contains_read`, not in `contains`; a new `make_plan` asks nothing about Kadhi.
  - `it("a 'not_for' answer keeps the dish from the person and re-plans that day")`: row `contains` has egg; the slot-day re-planned has GS fed (a dish without `not_for` GS).
- [ ] **Step 2: Run** the three files one at a time — FAIL.
- [ ] **Step 3: Implement.** `visitsOf`: one Visit per cook visit with meals named by a hard `cap` rule whose `slots` ⊆ the visit's meals (cap = `per_meal`, days = the rule's days or the cook's days), plus the custom/add-on slots whose `replacedMeal`, `addon_of` or linked `from` is one of those meals; `label` = `andList(meals.map(lower))` of the main meals.
- [ ] **Step 4: Run** the three files — PASS; `bun test server/reminder.test.ts` (reads slot dishes) — no new failures. Type check: no new errors.
- [ ] **Step 5: Commit** `feat(plan): unknowns asked in the weekly question; the answer saved on the dish; careful read removed`.

---

### Task 11: Manifest meal questions (§6.1, §10)

**Files:**
- Modify: `flock.app.json` (`setup[]`, `version` to the next minor)
- Modify: `server/manifest.test.ts` (FLOCK_VALUES, the id-order, cook/cookingDays/people/meals tests)

**Interfaces (the §10 contract, verbatim):**
- Order of ids: `pain`, `apps`, `mainApp`, `lunchWhere`, `cook`, `cookTime`, `otherDays`, `childSame`, `familyBreakfast`, `familyLunch`, `familyDinner`, `childMeals`, `differently`, `subscriptions`, `connectLater`, `orderFindings`, `final`. Removed: `people`, `cookingDays`, `kidsBreakfast`, `kidsLunch`, `kidsDinner`, `adultsBreakfast`, `adultsLunch`, `adultsDinner`, `diet`, `elders`, `rules`, `orderIn`.
- Fills: `lunchWhere:text`, `cook:text`, `cookTime:text`, `otherDays:text`, `childSame:text` + `childDiffers:list` (items `{ person, meals: ["Breakfast"|"Lunch"|"Dinner"], box: bool }`), `pastWeek.breakfast:text`, `pastWeek.lunch:text`, `pastWeek.dinner:text`, `childMeals:text`, `differently:text`.
- `childSame.when = "household.children"`; `childMeals.when = "childDiffers"`.
- New placeholders: `{{you}}`, `{{cookName}}`, `{{children}}`, `{{lunchKnown}}`; every ask with one has a `fallback` (no braces, no brackets); every asking question has a `reask`; a `recall` (new optional field) contains `{{heard}}` and no other placeholder, no brackets.

Draft wordings (owner reviews before build, Global Constraints):

| id (when) | ask | recall | reask | fallback |
|---|---|---|---|---|
| lunchWhere | `{{lunchKnown}} Who carries lunch from home, and who eats out?` | `You said {{heard}} about weekday lunch. Anything to add?` | `On weekdays, who carries lunch from home, and who eats out?` | `On weekdays, who has lunch at home, who carries lunch from home, and who eats out?` |
| cook (`household.help has cook`) | `Which meals does {{cookName}} make, and when does she come?` | `You said {{heard}} about the cook. Anything to add?` | `Which meals does your cook make, and when does she come?` | `Which meals does your cook make, and when does she come?` |
| cookTime (`household.help has cook`) | `Is {{cookName}} short of time, so only a few dishes?` | — | `Does your cook have time for the whole meal, or only a few dishes?` | `Is your cook short of time, so only a few dishes?` |
| otherDays (`cook.days = mon,tue,wed,thu,fri,sat`) | `On Sunday, when {{cookName}} doesn't come, who cooks, and is any meal eaten out or ordered in?` | `You said {{heard}}. Anything else about eating out or ordering in?` | `Who cooks on Sundays, and do you eat out or order in?` | `On Sunday, when your cook doesn't come, who cooks, and is any meal eaten out or ordered in?` |
| otherDays (`cook.days = mon,tue,wed,thu,fri`) | same with `On Saturday and Sunday` | same | `Who cooks at the weekend, and do you eat out or order in?` | same with "your cook" |
| otherDays (`cook.days`) | `On her days off, who cooks, and is any meal eaten out or ordered in?` | same | `Who cooks on her days off, and do you eat out or order in?` | — (no placeholder) |
| otherDays (`!cook.days`) | `Who cooks at home, and is any meal eaten out or ordered in, on which days?` | same | `Who does the cooking, and do you eat out or order in on some days?` | — |
| childSame | `Does {{children}} eat what the family eats, or something of their own at some meals? Any box for school?` | `You said {{heard}}. Anything else about what the children eat?` | `Do the children eat the family's food, or their own at some meals?` | `Do the children eat what the family eats, or something of their own at some meals? Any box for school?` |
| familyBreakfast | `What does the family usually have for breakfast? Tell me the dishes, and anyone who has something different.` | `You mentioned {{heard}} for breakfast. Anything else?` | `What do you usually have for breakfast? A few dishes are enough.` | — |
| familyLunch / familyDinner | same shape with lunch / dinner | same with lunch / dinner | same | — |
| childMeals (`childDiffers`) | `What does {{children}} have at those meals, and what goes in the box?` | `You mentioned {{heard}}. Anything else in the box?` | `What goes in the school box?` | `What do the children have at those meals, and what goes in the box?` |
| differently | `Does anyone eat differently: something they don't eat, an allergy, less spice or salt, a fasting day, or something extra on their plate?` | `You mentioned {{heard}}. Anything else, for anyone, like an allergy or a fasting day?` | `Is there anything someone at home doesn't eat, or eats differently?` | — |

`multi: true` on the three family meals and `childMeals`; `help` texts say what each fact holds "in their words" (the `help` lint words in manifest.test stay); `fixed: true` on all; `pain`, `apps`, `mainApp`, `subscriptions`, `connectLater`, `orderFindings`, `final` unchanged.

- [ ] **Step 1: Write the failing tests** in `manifest.test.ts`:
  - `it("the meal questions are the contract's, in its order")`: `uniq(setup.map(q => q.id))` equals the order above; none of the removed ids is present.
  - `it("each fact is the contract's")`: the fills listed above per id.
  - `it("childSame asks only with children; childMeals only when one differs")`.
  - `it("a recall carries what was heard and nothing else")`: every `recall` matches `/\{\{heard\}\}/`, has no other `{{…}}`, no `(`/`)`.
  - FLOCK_VALUES gains `you`, `cookName`, `children`, `lunchKnown`; the existing "reask / fallback iff placeholder / no brackets" test passes unchanged.
  - Remove/replace the tests on `people`, `cookingDays`, `kids*/adults*`, `diet`, `elders` with the new ones above (the "everyone saved before any rule" test becomes: no setup question targets `set_person`; people come from `household.people` through `apply_setup`).
- [ ] **Step 2: Run** `bun test server/manifest.test.ts` — FAIL.
- [ ] **Step 3: Implement** the JSON.
- [ ] **Step 4: Run** `bun test server/manifest.test.ts` — PASS; `bun run check` (the app-kit manifest check) — no new errors.
- [ ] **Step 5: Commit** `feat(manifest): meal questions in the one meaning model's shape (family meal, who differs, anyone differently)`.

---

### Task 12: Setup reads into the new shapes

**Files:**
- Modify: `server/setup.ts` (prompts `HOME_PART`, `RULES_PART`, `DISHES_PART`/`DISHES_SCHEMA`; `readOf`; `partsOf`, `buildMeal`, `writeKinds`, `writeOps`; `ruleSaid`, `readBack`)
- Test: `server/setup.test.ts`

**Interfaces:**
- Consumes: `KindPart`/`LinkedPart`, `bareDish` (Tasks 1–2), `resolveTarget`/`resolveGives`/`targetText` (Task 3), `replacedMeal` (Task 5).
- Produces:
  - `ReadSlot.extras?: boolean` (HOME schema `extras: boolean`: an add-on the person has beside the home meal, "I take 4 eggs and some salad"); a box that replaces a meal is `kind "custom"`, `after` that meal, `instead: true` → saved `order = SLOT_ORDER[meal] + INSTEAD_STEP` (existing `orderOf`).
  - `SetupRead.links: ReadLink[]`, `export type ReadLink = { slot: string; from: string; words: string; quote: string }` from a new DISHES column `links: [[slot, from_meal, kind_words_or_empty, quote]]` ("paratha rolled with the sabji that we make for lunch" → `["Agastya's lunch box", "Lunch", "sabji", …]`; "he has what we make for the whole family" → `["Agastya's breakfast box", "Breakfast", "", …]`).
  - `partsOf(d, meal): TemplatePart[]` returns kind parts with `words: place.word` and, for `named === "dish"` with no item but a `bareDish(kind, sub)`, `dish: bareDish(...)`; a dish named by a catalog item at a meal its kind is suggested keeps `{ kind, dish: item, words }` (was `{ kind }`).
  - `buildMeal(meal, dishes, seeds, links: { kind: string | null; sub: string | null; from: string }[]): MealShape` — a link with a kind joins every template of the slot as `{ from, kind, sub? }` (as a template of its own when the slot has none); a whole-plate link is the slot's one template `[{ from }]`; `MealShape.kinds` removed; templates carry `days` from the pinned dish (was dropped into the line only).
  - `writeKinds`: a dish whose place is `named === "category"` (no item, not a staple) is **removed from the library** after its words are on the part (§5.3); a named dish keeps its row (with kind/sub/catalog_item). `slots.kinds` never written.
  - Rules: `checkRead` maps each read rule to `targets = items.map(resolveTarget)` (plus derived for veg/egg/no_eggs) and a hard swap's `gives = resolveGives(to)`; `items`/`to` still saved (for the Family page text). A cook's dish limit (RULES prompt: "a cook short of time with a number of dishes is cap { per_meal: the larger number said, slots: that visit's meals }"; "3-4 dishes in the morning" → per_meal 4, slots the morning visit's meals) is a hard `cap`, never `cook_wont_make`.
  - `ruleSaid(r)` builds from targets: avoid `"no <targetText list>"`; swap `"<gives text> when it's <target text>"` (read-back line `"Agastya: Pancakes when it's upma"`); cap `"at most <n> dishes in the <label> visit"`.
  - DISHES prompt adds: "A filling said with a kind is an item of that kind: paratha rolled with egg or cheese inside is Egg paratha roll, Cheese paratha roll"; "A meal the person has beside the home meal is their add-on's (Shiva's lunch box: 4 boiled eggs, salad)"; "A box with the home meal's dish names a link, not a dish".
  - Speaker: setup names the speaker from `household.people` relation `self` (contract §10); a `"me"` in any read field resolves to `household.speaker` via `personOf` (unchanged); no hand-mapping in setup beyond that.

- [ ] **Step 1: Write the failing tests** (fake model returning canned JSON per part, as the file's existing tests do):
  - `it("a category word lives on its template part, never in the library")`: dishes `["Dry sabji", "Lunch", …]`, seed `["Lunch", "Rice, Dry sabji, Sambar"]` → Lunch template has `{ kind: "Sabzi", words: "dry sabji" }`; `listLibrary(db, { slot: "Lunch" })` has no "Dry sabji".
  - `it("a bare dosa is their Plain dosa; a bare upma stays a category")`: Breakfast templates include `{ kind: "Dosa", dish: "Plain dosa", words: "dosa" }` and `{ kind: "Upma", words: "upma" }`; library has "Plain dosa", no "Upma".
  - `it("the lunch box links the lunch sabzi; the breakfast box is the family breakfast")`: links read → "Agastya's lunch box" templates `[{ items: ["Paratha"] … }, { from: "Lunch", kind: "Sabzi" }]` (first part per partsOf of "Paratha") and `[{ items: ["Egg paratha roll"] }]`, `[{ items: ["Cheese paratha roll"] }]` share sometimes; "Agastya's breakfast box" templates `[{ parts: [{ from: "Breakfast" }] }]`; both custom with order 35 / 15.
  - `it("extras beside the home lunch are an extras add-on; the carrier stays at Lunch")`: "Shiva's lunch box" addon_of Lunch, `extras: true`, days Mon–Fri; weekday_lunch Shiva carries.
  - `it("rules naming a kind or a dish get typed targets")`: GS avoid ["egg"] → ingredient egg; GS avoid ["salad"] → kind Salad; Agastya swap ["upma"] → "pancakes" → targets kind Upma, gives item Pancakes; GS swap ["roti"] → "paratha" slots ["Dinner"] → gives per `resolveGives("paratha")`.
  - `it("the cook's limit is a cap on her morning visit")`: cap per_meal 4 slots ["Breakfast", "Lunch"], days Mon–Sat; `cook_wont_make` null.
  - `it("the read-back says templates and rules in the family's words")`: `said` contains `"Agastya: Pancakes when it's upma"`, `"Gowri Shankar: no egg, no salad"`, `"dry sabji"`; does not contain `"Dry sabji"` as a dish line or `"Agastya: pancake"`.
- [ ] **Step 2: Run** `bun test server/setup.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Existing tests that asserted category library rows or `kinds` are rewritten to the new shapes.
- [ ] **Step 4: Run** `bun test server/setup.test.ts` — PASS; `bun test server/onboardingRun.test.ts` — no new failures. Type check: no new errors.
- [ ] **Step 5: Commit** `feat(setup): save each word's meaning once: template words and dishes, links, extras, typed rule targets`.

---

### Task 13: Eval truth types and scorer checks (§7)

**Files:**
- Modify: `evals/lib/truth.ts` (types), `evals/lib/score-plan.ts`, `evals/lib/score-setup.ts`, `evals/lib/adapter.ts` (`readPlan` reads `for_people`; `loadSetup` writes templates without kinds, rules with targets, slots with extras)
- Test: `evals/lib/score-plan.test.ts`, `evals/lib/score-setup.test.ts` (and `evals/lib/test-fixture.ts`)

**Interfaces:**
- Produces (truth.ts, still importing nothing from `server/`):
  ```ts
  export type TruthPart = { kind: string; sub?: string; words?: string; dish?: string } | { items: string[] } | { from: string; kind?: string; sub?: string };
  export type TruthTemplate = { parts: TruthPart[]; share?: Frequency; days?: Weekday[] };
  export type TruthTarget = { kind: string } | { kind: string; sub: string } | { item: string } | { ingredient: string };
  // TruthRule gains targets?: TruthTarget[]; gives?: TruthTarget
  // TruthSlot gains extras?: boolean; replaces?: string   (the main meal a box replaces)
  // TruthMeal: `own` kept; Household gains transcript?: string[]  (fixed Q/A lines: no persona simulation)
  export const linked: (from: string, kind?: string, sub?: string) => TruthPart;
  export const kindPart: (kind: string, o?: { sub?: string; words?: string; dish?: string }) => TruthPart;
  ```
- New score-plan checks (names are the report keys; add `real_dish` change, `linked_parts`, `unknowns_asked`, `no_silent_filler`, `box_attendance` to `BASE` in `eval-e2e.ts` and `no_silent_filler` to `SAFETY`):
  - `real_dish` (extended): no planned dish name equals, as plain words, a TRUTH template part's `words` or a bare kind/sub-kind name of `lib/catalog.ts` unless it is a TRUTH `items` dish; no saved library row (setup out) is a TRUTH part's `words`; setup-side `no_filling_kind`: no saved own kind is named after a filling word of a TRUTH item ("Cheese", "Egg").
  - `linked_parts`: for each TRUTH linked part, on each date both slot-days have dishes, the linked slot-day holds the source's item of that kind (eval's `kindOf`) — or the whole source plate — unless the source is skipped that day.
  - `unknowns_asked`: every dish on a slot-day with a TRUTH rule person for whom the loaded library's `contains_read` lacks the rule's ingredient appears in the plan's question or is counted in its "<n> more" (parse `asked[0]`).
  - `no_silent_filler`: every `not_for` person on a dish breaks a TRUTH rule for that dish by the eval's vocab (vocab.ts) or kind target (catalog.ts `kindOf`); a dish added only for one person (`for_people`) is a TRUTH swap's `gives`, or the person has a known break on the plate.
  - `box_attendance`: a TRUTH box (`replaces: M`) takes its people off M only on its days; an `extras` add-on's people stay at the main.

- [ ] **Step 1: Write the failing tests** in `score-plan.test.ts` on the hand-made fixture (extend `test-fixture.ts` with a lunch box `replaces: "Lunch"` linked to Lunch Sabzi, an extras add-on, a swap): one passing week and one failing week per check, e.g. `it("linked_parts fails when the box rolls a sabzi lunch did not have")`, `it("real_dish fails on 'Dry sabji'")`, `it("unknowns_asked fails when an unread Kadhi for an egg-free elder is not in the question")`, `it("no_silent_filler fails when Idli is added for the elder with no known break")`, `it("box_attendance fails when the breakfast box takes the child off Lunch")`.
- [ ] **Step 2: Run** `bun test evals/lib/score-plan.test.ts` — FAIL; then `bun test evals/lib/score-setup.test.ts`.
- [ ] **Step 3: Implement.** `score-setup.ts` `templates` check compares parts including `words`/`dish`/linked; `hard_rules` compares `targets` when TRUTH gives them.
- [ ] **Step 4: Run** both files one at a time — PASS; `bun test evals/lib/households.test.ts` — no new failures. Type check: no new errors.
- [ ] **Step 5: Commit** `feat(evals): score plates as real dishes, linked parts, asked unknowns, no silent filler, box attendance`.

---

### Task 14: Eval households in the new shapes, and h18

**Files:**
- Modify: `evals/lib/interview.ts` (new ids; fill `{{you}}` "you", `{{cookName}}` the help cook's name else "your cook", `{{children}}` names joined "A and B", `{{lunchKnown}}` the weekday lunch line from `household.weekly` with the speaker as "you"; `childDiffers` read from facts id `childSame`'s `differs` field), every `evals/households/h*.ts` and `heldout*/h*.ts` (facts re-keyed: `lunchWhere`, `cook`, `cookTime`, `otherDays`, `childSame`, `familyBreakfast`, `familyLunch`, `familyDinner`, `childMeals`, `differently`, `subscriptions` — merge the old kids/adults/diet/elders/rules/orderIn texts into these, same facts; `household.mealsBy` / `household.groceriesBy` / `household.schoolBy` rewritten from strings to the §6.3b list shape, e.g. h1 `"household.mealsBy": [{ person: "Neha" }], "household.groceriesBy": [{ person: "Neha" }]`, a sentence naming two people split into two entries with each one's words as `part` (no other wording change); TRUTH `meals` parts with `words`/`dish`/linked where the facts say so; category library rows removed from TRUTH library; rules with `targets`; `household.people` keeps the speaker as `relation: "self"` — already true in h3)
- Create: `evals/households/h18-shiva-walkthrough.ts`; register in `evals/households/index.ts` (`HOUSEHOLDS`) and `eval-e2e.ts` `TIERS` (`"h18-shiva-walkthrough": "C"`)
- Modify: `evals/eval-e2e.ts` (`runOne`: when `h.transcript` is set, use it and skip the transcript file)
- Test: `evals/lib/households.test.ts`

**h18 (exact values).** Household facts — the contract's shape only, nothing else cleaned: `household.speaker: "Shiva"`; `household.people`: Shiva (`relation: "self"`, adult), Ankita (wife, adult), Agastya (son, 6, child), Gowri Shankar (father, elder); `household.children: ["Agastya"]`, `household.elders: ["Gowri Shankar"]`; `household.help: [{ role: "cook", days: "Mon-Sat", times: "morning", meals: ["Breakfast", "Lunch"] }, { role: "cook", days: "Mon-Sat", times: "afternoon", meals: ["Dinner"] }]` (no name, free-text times); `household.weekly`: Ankita office Mon–Fri 09:00–16:00; Agastya school "TCIS" Mon–Fri 07:20–15:00; Gowri Shankar home; no entry for Shiva (none was given). No `household.mealsBy` / `groceriesBy` / `schoolBy` (the walk-through's meals part gives none; the Flock lane's payload adds them when its run has them). `groceryApps: ["Zepto", "Instamart"]`.

`transcript` (Q lines = Task 11 asks with placeholders filled as Flock would; A lines word for word):
```
Q: What's the hardest part of meals for you? Or something else.
A: 1 and 2
Q: Which apps do you order groceries on: Zepto, Blinkit, Instamart, BigBasket or Amazon? …(manifest text)
A: Zepto main, Instamart next
Q: Which is your main app, and which do you use when something isn't there?
A: Zepto main, Instamart next
Q: On weekdays Ankita is at the office till 4 and Agastya is at school till 3; Gowri Shankar is at home. Who carries lunch from home, and who eats out?
A: Ankita eats lunch at office. Agastya and I carry lunch from home. Dad eats at home.
Q: Which meals does your cook make, and when does she come?
A: she comes in the morning for breakfast & lunch. comes in the afternoon for dinner
Q: Is your cook short of time, so only a few dishes?
A: yes she can do only 3-4 dishes in the morning
Q: On Sunday, when your cook doesn't come, who cooks, and is any meal eaten out or ordered in?
A: Ankita cooks sometimes for sunday breakfast and lunch. Otherwise we order. Sunday dinner is typically always ordered
Q: Does Agastya eat what the family eats, or something of their own at some meals? Any box for school?
A: Agastya carries Breakfast box for school. Typically, he has what we make for the whole family. South indian typically - idli, dosa, poha, upma, etc. Sometimes we pack him Pancakes for his breakfast in case we make upma since he doesnt like it.
Q: What does the family usually have for breakfast? Tell me the dishes, and anyone who has something different.
A: South indian typically - idli, dosa, poha, upma, etc. On sundays we have bread omlette.
Q: What does the family usually have for lunch? Tell me the dishes, and anyone who has something different.
A: lunch is mostly south indian - rice, dry sabji, and something like sambar/rasam/kootu/kadhi/dal/etc. I take 4 eggs for my lunch and some salad. Dad doesnt eat egg or salad. Ankita doesnt carry lunch.
Q: What does the family usually have for dinner? Tell me the dishes, and anyone who has something different.
A: north indian - dad has 2 parathas, Ankita 2 rotis, Agastya 2 rotis, myself 3 rotis. With some north indian gravy or dry sabji. Like paneer butter masala, matar paneer, aloo gobi. Or sometimes gobi paratha, aloo paratha, etc.
Q: What does Agastya have at those meals, and what goes in the box?
A: He carries a lunch box which is usually paratha rolled with the sabji that we make for lunch. Or sometimes with egg or cheese inside it to make it interesting depending on the sabji. Dinner is what we make for ourselves
Q: Does anyone eat differently: something they don't eat, an allergy, less spice or salt, a fasting day, or something extra on their plate?
A: he doesnt eat eggs. nothing too spicy, but nothing else. on saturdays we make egg curry sometimes. And have bread omlette for sunday breakfast. Dad doesnt eat egg. Others are okay with it. So we have to make something else for him if we make egg curry or if mains contains eggs
Q: Does anything come on a subscription, like Country Delight or a milkman?
A: no we order milk on zepto
```
(The walk-through answered "Dinner is what we make for ourselves" to the kids-dinner question; it is kept on the childMeals reply above, the closest new question. The family-breakfast reply reuses the walk-through's own breakfast words; "bread omlette" is from the rules reply. No words are invented.)

TRUTH:
- people as above; cook `{ name: "Cook", days: MON_SAT, visits: [{ meals: ["Breakfast", "Lunch"] }, { meals: ["Dinner"] }] }` (`TruthCook.visits[].at` becomes optional; `score-setup` `cook_times` skips a visit without `at`); familyCooks `[{ person: "Ankita", days: ["Sun"] }]`.
- slots: `mains({ Dinner: [{ day: "Sun", skip: "ordered_in" }] })`; `"Agastya's breakfast box"` custom `[Agastya]` SCHOOL `replaces: "Breakfast"` match `/breakfast/i`; `"Agastya's lunch box"` custom `[Agastya]` SCHOOL `replaces: "Lunch"` match `/lunch ?box|tiffin/i`; `"Shiva's lunch box"` addon_of Lunch `[Shiva]` SCHOOL `extras: true` match `/shiva/i`.
- away: Ankita Lunch SCHOOL; Agastya Breakfast and Lunch SCHOOL (by his boxes).
- library (named dishes only): Idli, Plain dosa, Pancakes (Breakfast, `alsoSlots: ["Agastya's breakfast box"]`), Bread omelette (Breakfast, days Sun), 4 boiled eggs (Shiva's lunch box), Egg paratha roll and Cheese paratha roll (Agastya's lunch box, sometimes), Paneer butter masala, Matar paneer, Aloo gobi, Gobi paratha, Aloo paratha, Egg curry (Dinner, days Sat, sometimes). Not in library: upma, poha (bare words of categories unless Task 1's owner-reviewed list makes poha a dish), dry sabji, sambar, rasam, kootu, kadhi, dal, gravy, roti, rice, salad.
- meals:
  - Breakfast: `tpl([kindPart("Idli")])`, `tpl([kindPart("Dosa", { dish: "Plain dosa", words: "dosa" })])`, `tpl([kindPart("Poha")])`, `tpl([kindPart("Upma", { words: "upma" })])`, `{ parts: [items("Bread omelette")], days: ["Sun"] }`.
  - Agastya's breakfast box: `tpl([linked("Breakfast")])`.
  - Lunch (staples Rice): five templates `tpl(["Rice", kindPart("Sabzi", { words: "dry sabji" }), "Rice curry/Sambar"])`, same with `Rice curry/Rasam`, `Rice curry/Kootu`, `Rice curry/Kadhi`, `Dal`.
  - Shiva's lunch box: `tpl([items("4 boiled eggs"), kindPart("Salad", { words: "salad" })])`.
  - Agastya's lunch box: `tpl([kindPart("Paratha", { words: "paratha" }), linked("Lunch", "Sabzi")])`, `tpl([items("Egg paratha roll")], "sometimes")`, `tpl([items("Cheese paratha roll")], "sometimes")`.
  - Dinner (staples Roti): `tpl(["Roti", kindPart("Gravy", { words: "north indian gravy" })])`, `tpl(["Roti", kindPart("Sabzi", { words: "dry sabji" })])`, `tpl([kindPart("Paratha", { words: "gobi paratha, aloo paratha" })], "sometimes")`, `{ parts: ["Roti", items("Egg curry")], share: "sometimes", days: ["Sat"] }`.
- rules: GS avoid `targets [{ ingredient: "egg" }]` quote `/egg/i`; GS avoid `targets [{ kind: "Salad" }]` quote `/salad/i`; GS note `/spicy/i`; Agastya swap hard `targets [{ kind: "Upma" }]`, `gives { item: "Pancakes" }`, slots Breakfast + "Agastya's breakfast box", quote `/upma/i`; GS swap hard `targets [{ kind: "Roti" }]`, `gives { item: "Plain paratha", kind: "Paratha" }` slots Dinner quote `/paratha/i`; cap hardAny per_meal 4 slots ["Breakfast", "Lunch"] days MON_SAT quote `/3-4 dishes/i`.
- judgeNotes: "Gowri Shankar gets a non-egg dish when the plate has egg curry or bread omelette.", "Agastya's boxes follow the home meal; pancakes on upma days.", "Sunday dinner ordered in."

- [ ] **Step 1: Write the failing tests** in `households.test.ts`: `it("every household's facts answer the new question ids")` (each fact id ∈ the Task 11 id list or `correction`); `it("every TRUTH template part is a real catalog kind/sub, an own kind, items, or a link to a slot of that household")`; `it("no TRUTH library row is a category word of a TRUTH part")`; `it("every household names its speaker as self exactly once, and no one 'me'")`: for each of `ALL_HOUSEHOLDS` (h18 included), `household.people.filter(p => p.relation === "self")` has length 1 and its name is `household.speaker` (or the household's `owner`); no `household.weekly` person matches `/^(me|i|myself)$/i`; `it("who looks after meals, groceries and school is a list of names")`: for each household, `household.mealsBy`, `household.groceriesBy`, `household.schoolBy`, when present, are arrays of `{ person: string; part?: string }` whose `person` is a `household.people` name; `it("the planner's server never reads the looked-after-by facts as text")`: no file under `server/` (excluding `*.test.ts`) contains `mealsBy`, `groceriesBy` or `schoolBy` (read file texts in the test; if a reader is added later it must change this test deliberately); `it("h18's transcript is the walk-through's answers")`: 14 `A:` lines, the lunch answer equals the walk-through text above.
- [ ] **Step 2: Run** `bun test evals/lib/households.test.ts` — FAIL.
- [ ] **Step 3: Implement** the re-keying (texts kept; only ids and TRUTH shapes change) and h18.
- [ ] **Step 4: Run** `bun test evals/lib/households.test.ts` — PASS; `bun evals/eval-setup.ts --self-test` — TRUTH vs itself passes for every household. Type check: no new errors.
- [ ] **Step 5: Commit** `feat(evals): households in the one meaning model's shapes; h18 from the owner's walk-through`.

---

### Task 15: End-to-end run (acceptance, after all tasks)

**Files:** none changed unless a run shows a defect (then a new task, TDD, never a patch in this step).

- [ ] **Step 1:** `bun evals/eval-e2e.ts --only h18 --repeat 3` (uses h18's fixed transcript). Expected: SAFETY (incl. `no_silent_filler`) passes every run; report `linked_parts`, `real_dish`, `unknowns_asked`, `box_attendance`, `attendance` rates. Read the three weeks against the owner-confirmed plan (Breakfast rotates Idli/Plain dosa/Poha/Upma (Pancakes only for Agastya on Upma days), Bread omelette Sunday with a non-egg dish for Gowri Shankar; boxes; five Lunch templates for Gowri Shankar + Shiva; Shiva's extras Mon–Fri; Dinner roti/paratha + gravy or dry sabzi, egg curry some Saturdays with his alternative; Sunday dinner ordered).
- [ ] **Step 2:** `bun evals/eval-e2e.ts --only h1,h2,h3,h13 --repeat 1` — tier verdicts no worse than the last saved run in `evals/results/`.
- [ ] **Step 3:** Held-out discipline: `--heldout2` (h15–h17) runs once, after tuning ends, and its result is reported as is.
- [ ] **Step 4:** Write the run's `summary.md` path into the report for the owner. Evaluating through Flock's real payload (`householdFor`) and the interview sim checks belong to the Flock lane and run on the merged pair (§8).

---

## Ambiguities settled in this plan (for owner / lead check)

1. **Linked whole plate:** `LinkedPart.kind` is optional; no kind = the whole plate (§5.1 lists `{from, kind, sub?}`, §5.4 uses `{from:"Breakfast"}`).
2. **A breakfast box takes its child off Breakfast** (it replaces that meal), never off Lunch; "replaces" is stored as today's `INSTEAD_STEP` order convention, not a new column.
3. **Extras add-on** needs a stored flag: new `slots.extras` (an add-on beside the main plate), because today an add-on takes its person off the main plate in `fillWeek` (`atTable`). Old add-ons keep today's behaviour.
4. **Swap item for one person** is a slot_dishes row with new `for_people` (shown "Pancakes (for Agastya)" by the existing `dishText`), so it lands on the grocery list, history and the cook's count with no new path.
5. **Plan-and-ask answer** rides `record_feedback` (the existing weekly-reply op) as `answer: "fits" | "not_for"` with `who`.
6. **Dad's Roti → Paratha** (lead's call from "dad has 2 parathas", owner to confirm): gives item Plain paratha (Paratha's `bare` is "Plain paratha"); the lunch-box roll is a plain paratha too.
7. **Pancakes is not a family Breakfast template** (owner, 26 Nov): it is only Agastya's swap on Upma days (Breakfast and his box).
8. **"Wet" sabzi** for egg/cheese roll days = the Lunch item's place is a Gravy kind or sub-kind (§11 left to the builder).
9. **Legacy slots without templates** get them once in the migration (`deriveTemplates` moves there); the planner no longer derives templates from plate names each run.
10. **`slots.kinds` column stays** (app-kit refuses dropping a column with rows); it is nulled and unread.
11. **Visit cap count includes staples** (§9.3 says so); the over-limit note goes in `unmet`, worded `"<Day> breakfast and lunch: <n> dishes to cook, more than <cook>'s <cap>"`.
12. **h18's "Dinner is what we make for ourselves"** is placed on the childMeals reply (no kids-dinner question exists any more), and the family-breakfast reply reuses the walk-through's breakfast words; nothing else is added or cleaned.
