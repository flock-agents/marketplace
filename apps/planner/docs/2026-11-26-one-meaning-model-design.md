# One meaning model: from the interview to the plan

Date: 2026-11-26. Status: design, awaiting owner approval. Repos: Meal Planner (marketplace `apps/planner`) and Flock
(`flock-app/server/src/onboarding-interview`).

## 1. Why

The owner's own walk-through (instance `~/.flock-rh-3`, planner 4.1.3 = `planner-v4.1.0-rc4`) produced a bad first week:
Idli every breakfast, bare "Dry sabji" and "Cheese" as lunch dishes, most dishes "not for Gowri Shankar / Agastya",
weekday lunch cooked for one person, and an interview that asked several things twice. Evals A/B/C had passed.

The owner asked for root causes, not symptom patches. They are:

| # | Root cause | Evidence in the walk-through |
|---|---|---|
| R1 | No single record of what a family word means. Setup decides (kind / category / dish) but the decision lives only in `setup_state.places`; library rows keep the raw word; the planner re-decides from the name (`fillWeek.ts isCategoryName` → `matchDish(name)`). | "dry sabji": setup = category Sabzi; planner: no catalog match → a dish called "Dry sabji", the family's own, placed first. |
| R2 | Rules never moved to the kinds model: they are ingredient tags read per dish (`contains`/`contains_read`). A rule naming a dish or kind becomes a made-up tag. | "avoid salad", "swap upma" → tags `salad`, `upma`; no catalog item was read for them. |
| R3 | Every hard rule fails closed, and "nobody without food" fills the hole silently. | Unknown `salad`/`upma` → every new item "not for" Gowri / Agastya → Idli (the only item read for both) added every day; lunch parts left empty. |
| R4 | No way to say one person's food is a version of the shared meal. | Shiva's "4 eggs + salad" became a shared lunch template; egg/cheese in Agastya's paratha became separate parts and a "Cheese" own kind; Dad's parathas lost; Agastya's breakfast box took him off Lunch (`planDays.ts:265`). |
| R5 / I1 | The speaker is not a person in their own household. `household.people` lists who lives *with* them; the weekly pattern names them `"me"`. Fix 4c654e9c8 only covers the list reaching *another* person. | Planner people: Ankita, Agastya, Gowri Shankar; recap "Ankita and me"; Shiva has no lunch. |
| I2 | The interview asks kids × 3 meals then adults × 3 meals; families answer "one family meal + exceptions" (same missing concept as R4). | "he has what we make for the whole family" → adults' breakfast still asked; adults' dinner "kept … still to ask". |
| I3 | Two questions own the same fact. | cookingDays "Is any day's meal eaten out?" + orderIn "How often do you order in…". |
| I4 | A thing already said is re-asked as the generic question (guards against wrong early closes + "never skip"). | Above two. |
| I5 | Question wording drops raw values into fixed sentences. | "The cook cooks: comes at twice a day."; "the children" for one child; read-back "Agastya: pancake". |
| R6 | Evals cannot see any of it: eval households pass a clean `household.people` with the speaker as "self" (`evals/households/h3-shiva.ts:12`); no rule names a dish; no box derived from a home meal; the scorer does not check a plate is made of real dishes. | A/B/C passed; the live run failed. |

## 2. Goals, non-goals, anti-goals

**Goals**
- Each family word is decided once (at setup) and that decision is what the planner reads. The planner never matches
  names again.
- Rules speak the same language as meals: kind / sub-kind / item / ingredient.
- A shared cooked meal can have per-person versions: a packed box that follows the home meal, a person's extras, a
  swapped part.
- The interview collects meals in that same shape (family meal first, then who differs), never asks a thing twice in the
  generic form, and addresses the speaker as "you".
- Evals go through the real interview payload and catch every failure above.

**Non-goals (this design)**
- Portions per person (Dad 2 parathas, Shiva 3 rotis) and grocery quantities: follow-up.
- Sunday cooking by a family member fitting what they make, "not too spicy" used in planning: follow-up.
- Grocery-order driven item choice, one-meal re-plan, the meals split to another person: backlog.

**Anti-goals (a failure even if it "works")**
- A bare category word on a plate ("Dry sabji", "Sabzi", "Gravy").
- One unknown spreading across the week (a dish silently dropped for someone, a filler dish repeated).
- A question the person already answered asked again in its generic form.
- The planner and setup disagreeing about what a word is.

## 3. Constraints

- Plans are drafts the family edits; new dishes are offered as the one question in the weekly message (owner rules
  in force: ≥30% own, no new kinds unless asked, variants repeat only when all options used, never next day).
- Existing stage installs (planner 4.0.x/4.1.x saved setups) must keep working: migration on upgrade.
- Interview rules in force: code words every question, the model only reads replies; a question is never skipped unless
  the person explicitly skips (`interview-never-skips-questions`).
- Tests: run files one at a time; never the full suite (laptop crash).

## 4. Approaches considered

**Where a word's meaning lives**
- *Chosen: extend the current tables.* Templates carry the meaning; library becomes history; rules get a target.
  Least change to `fillWeek.ts` (already fills kind parts from the catalog); stage installs migrate.
- *Rejected: a new `words` table* every row points at. Cleanest single record, but a rewrite of setup, planner, read-back,
  scorer and truth files for no behaviour the chosen way lacks. The root cause was re-deciding, not two tables.

**Alternatives in a meal ("sambar or rasam or dal")**
- *Chosen (owner): one template per alternative.* Simple, expandable ("we also do curd rice" = one more template); the
  planner already spreads templates evenly and rotates inside parts.
- *Rejected: one template with "one of" parts.* Needs a new part type; harder to extend.

**Per-person versions of a meal**
- *Chosen (owner): their own row* (Agastya's lunch box, Shiva's lunch box) with a part that can **link** to another meal's
  part; a swap of one part (bread, upma) is a note on the shared row.
- *Rejected:* everything inside the Lunch row (crowded for the cook); notes only (egg/cheese days never planned).

**When the planner cannot tell if a dish breaks a rule**
- *Chosen (owner): plan it and ask* in the weekly message, for every kind of rule.
- *Rejected:* fail closed for all (what spread one unknown across the week); fail closed only for allergies/strict diets.

## 5. The model (decided)

### 5.1 Templates: the only place a word's meaning lives

A meal (slot) has templates; **each alternative is its own template**. A template is a list of parts. A part is exactly
one of:

| Part | Meaning | Example |
|---|---|---|
| `{ kind, sub?, words?, dish? }` | A kind or sub-kind, filled from catalog items. `words`: the family's own words for it ("dry sabji", "upma"), kept for the read-back and messages. `dish`: when their bare word names one dish, that dish (theirs, filled first). | `{kind:"Sabzi", sub:"Sabzi", words:"dry sabji"}`; `{kind:"Dosa", dish:"Plain dosa", words:"dosa"}`; `{kind:"Upma", words:"upma"}` |
| `{ items }` | Fixed dishes of theirs; nothing suggested. | `{items:["Egg paratha roll"]}` |
| `{ from, kind, sub? }` **(new)** | Linked: the item another meal has for that kind that day. | `{from:"Lunch", kind:"Sabzi"}` |

Template keeps `share` / `said` (how often, the family's words) as today.

- **Bare word = dish or category is decided per word, by the catalog.** Owner: "dosa" means Plain dosa (stored as their
  dish), while the template part stays kind Dosa so uthappam etc. can be offered as new; "upma" is a category (rava,
  semiya, dalia all theirs, no single dish stored); "dry sabji", "gravy", "curry" are categories. The catalog
  (`kinds.json`) gains, per kind / sub-kind, `bare: <item name> | null` (the dish its bare word means). Which kinds get
  a `bare` dish: builder drafts, owner reviews the list (like the kinds catalog review).
- **Category items count as the family's own** (decided 25 Nov), except a kind part with `dish`: there only that dish is
  theirs; other items of the kind are new (asked).
- **"etc." in a part**: new suggestions stay inside that part's sub-kind (a new sambar on a sambar template), never a new
  kind or sub-kind.
- A filling said with a kind is an item of that kind: "paratha with egg or cheese inside" → Egg paratha, Cheese paratha
  (catalog item when there is one, else the family's own item of that kind).
- `slots.kinds` is removed: the kinds a meal has are those its templates name. (`staple`/`own` flags move onto the part
  or come from the catalog.)
- `setup_state.places` stays only as setup's memory for correction rounds; nothing in planning reads it.

### 5.2 Rules: per person, with a target

A rule is about a person (or the house), optionally limited to meals/days, and **targets exactly one** of: a kind, a
sub-kind, an item, or an ingredient.

| Said | Rule |
|---|---|
| "Dad doesn't eat egg" | Gowri Shankar · avoid · ingredient `egg` |
| "Dad doesn't eat salad" | Gowri Shankar · avoid · kind `Salad` |
| "Pancakes for Agastya when we make upma, he doesn't like it" | Agastya · swap · kind `Upma` → item `Pancakes` |
| "Nothing too spicy for Dad" | Gowri Shankar · note (soft) |

- Kind / sub-kind / item targets are checked against the **part's saved kind and item**: always known, never read by a
  model. Rava upma is an Upma.
- Ingredient targets are checked through the catalog's ingredient lists (decided 21: only a *main* ingredient breaks a
  dish; a leave-out-able one is a "make without X for P" note). Only a family's own dish outside the catalog needs a
  model read of its ingredients (setup, as today).
- A swap: wherever the swapped target is planned and the person eats that meal, their portion is the swap item (a note
  on the shared row; in a box row, the box gets the swap item).
- **Unknown = plan and ask** (owner): a dish whose fit for a rule is not known is planned, and the weekly message's one
  question asks ("Is the Kadhi OK for Dad, no egg?"). No rule fails closed. **Allergies included** (owner, 26 Nov, told
  the trade-off: an unchecked dish can reach an allergic person's plate, the question is the safeguard): the careful
  allergy read (`makePlan.ts` provisional/strict/carefulRead) is removed; allergy unknowns are named first in the
  question. "Nobody without food" only fills a real
  break, never an unknown.
- Existing `what` kinds (veg, no_eggs, only, require, fasting, cap…) keep their meaning, expressed with targets.

### 5.3 Library: history only

The library holds dishes: those the family named as dishes (Plain dosa, Idli, Aloo gobi, Egg paratha…) and items that
came into their weeks (made, accepted, rated, disliked, offered/untried). It drives rotation, "never next day", ratings
and the new-dish answers. **A category word is never a library row.**

### 5.4 Per-person versions of a shared meal

| Family said | Model | On the plan |
|---|---|---|
| Agastya carries a paratha roll with the lunch sabzi, sometimes egg/cheese inside | Custom slot "Agastya's lunch box", Mon–Fri, `usual_people:[Agastya]`; templates `[Paratha, {from:"Lunch", kind:"Sabzi"}]` and `[{items:[Egg paratha roll]}] \| [{items:[Cheese paratha roll]}]` (sometimes) | `Agastya's lunch box  Paratha roll with Beans poriyal` |
| Shiva carries the home lunch plus 4 eggs and salad | Shiva counted at Lunch; add-on slot "Shiva's lunch box" (`addon_of: Lunch`, Mon–Fri) with fixed items 4 boiled eggs, salad | `Shiva's lunch box  + 4 boiled eggs · Cucumber salad` |
| Dad has parathas, others rotis | Swap rule Gowri Shankar · Roti → Paratha at Dinner | Note on the Dinner row |
| Agastya's breakfast box = family breakfast, pancakes on upma days | Custom slot "Agastya's breakfast box" linked to Breakfast (`{from:"Breakfast"}` whole plate), swap rule applies | Box row, or note |

- **Linked parts**: filled after the meal they link to (slot order); never counted as a separate repeat; counted once in
  the cook's dish count. If the linked meal is not cooked that day (eaten out / ordered in), the part picks its own item.
- Egg/cheese days: the "sometimes" template; the planner prefers it on days the Lunch sabzi is a wet one that does not
  roll (builder's call on how "wet" is read: catalog sub-kind Gravy vs dry Sabzi).
- **Attendance**: only a box that replaces a meal takes its person off that meal (a lunch box off Lunch; a breakfast box
  never off Lunch). A carried home lunch (`carries`) counts the person at Lunch.

### 5.5 The speaker is a person (R5 / I1)

Flock adds the speaker to their own `household.people` (relation `self`) from the first household answer, and resolves
`"me"` in `household.weekly` (and any list) to the speaker's name. Every payload (`householdFor`, `familyFacts`) carries
the speaker as a person. All wording that names people addresses the speaker as "you" ("you and Ankita are at the
office").

## 6. The interview (decided)

The meal questions live in the planner manifest (`flock.app.json` `setup[]`, `when` conditions evaluated by Flock); the
wording, recall and parsing live in Flock.

### 6.1 Flow (meals part)

1. Hardest part of meals. *(unchanged)*
2. Grocery apps; main app. *(unchanged)*
3. **Lunch where** — from known facts, addressed to the speaker, asking only what is open:
   "On weekdays you and Ankita are at the office and Agastya is at school till 3; Dad has lunch at home. Who carries
   lunch from home, and who eats out?" (Never re-asks who is home all day when the household part said it.)
4. **Cook**: "Which meals does your cook make, and when does she come?" (cook's name when known); then "Is she short of
   time, so only a few dishes?" — the limit saved as the cook's dish limit, not "won't make".
5. **Other days** (the one question that owns eating out / ordering in): "On her days off, who cooks, and is any meal
   eaten out or ordered in?"
6. **Does the child eat what the family eats?** "Does Agastya eat what the family eats, or his own food at some meals?
   Does he carry a box to school?" — the answer decides 8. Several children: asked together, split only if they differ.
7. **The family's breakfast, lunch, dinner** (one question each), with recall when already mentioned.
8. **Only where 6 said they differ**: that child's own meal / box ("What goes in Agastya's lunch box?"), with recall.
9. **Anyone eating differently** — replaces diet, elders and rules: "Does anyone eat differently: something they don't
   eat, an allergy, less spice or salt, a fasting day, or something extra on their plate?" with recall of rules already
   heard ("You mentioned Dad doesn't eat egg or salad, and Agastya has pancakes when it's upma. Anything else, for
   anyone?"). Allergies are named in the question (they rarely come up in "what did you eat").
10. Subscriptions. *(unchanged)*
11. Read-back.

**Dropped** (owner): `orderIn`, `diet`, `rules`, the separate elders questions, kids/adults × 3 meal questions.

### 6.2 Recall instead of re-ask (I4)

A question is never skipped. When facts for it were already said (in passing, copied, partly), it is asked in its
**recall form**: what was heard + "anything to add?". Generalises the existing people-list mechanism (`MENTIONED` facts,
"known form", `runner/index.ts` `keepSaid`, A4b) from `w1/h1/h3` to every question. Each question in the manifest gets a
`recall` wording with a slot for what was heard; the reply's answer merges with what was kept.

### 6.3 Wording (I5)

- No raw value dropped into a sentence written for another shape: the cook's free-text times are never put in a clock
  slot; a role is never used as a name ("your cook", or her name).
- Group words follow the count and names: one child → his/her name; several → "the children" or the names.
- Read-back rule lines are built from the rule's target ("Agastya: Pancakes when it's upma").

### 6.4 What the interview hands the planner

The transcript (as today) plus household facts with the speaker in people. Setup reads the family-meal answers into
templates (5.1), the "who differs" answers into box / add-on slots and swap rules (5.4), and "anyone eating differently"
into rules (5.2). The read-back shows templates and rules in the family's words.

## 7. Evals (R6)

- New household **h18-shiva-walkthrough** from the owner's walk-through answers, run **through the Flock payload**
  (`householdFor`), not a hand-built `household.people`.
- Cases that must be covered by at least one household: a rule naming a kind (salad, upma); a swap on a kind; a category
  word not in the catalog aliases ("dry sabji"); a box linked to the home meal; a carried home lunch; a person's extras;
  a breakfast box beside a home lunch.
- Scorer: every plate is made of real dishes (no part filled by a category word; no own kind invented from a filling);
  linked parts equal the linked meal's item; "plan and ask" unknowns appear in the one question; no person
  silently given a filler dish.
- Interview sim: no question asked twice in generic form; recall form used when facts were said; speaker addressed as
  "you"; no raw-value wording ("comes at twice a day").
- Held-out discipline unchanged: h15–h17 run once after tuning.

## 8. Build shape

Two lanes, parallel worktrees:
- **Planner lane** (marketplace `apps/planner`): 5.1–5.4, migration, setup read + read-back, manifest interview
  questions (6.1), evals (7).
- **Flock lane** (`onboarding-interview`): 5.5, recall generalised (6.2), wording (6.3), conditional questions on the
  new manifest keys.
The interview sim and the e2e eval run on the merged pair before a live WhatsApp run; no PR before the owner tests.

## 9. Settled after the builder check (lead's calls, owner to check)

1. **Plan-and-ask questions in the one weekly question.** Unknowns join `planQuestion` (messages.ts) with new dishes and
   calendar asks; up to 3 named ("Is the Kadhi OK for Dad, no egg?"), the rest counted ("and 2 more to check on the
   week page"). An answer is saved as the dish's read for that rule (`contains_read` + `contains`, by the existing
   weekly-reply path), so it is never asked again; "no" = the dish is not for that person and is swapped that day.
2. **The speaker is a person in the shared household facts, at the source** (root cause, not the planner payload only):
   Flock's household derive adds `{ name, relation: "self" }` and rewrites `"me"`/`"I"` in `household.weekly` and lists
   to the name. Other readers keep working: calendar-step.ts already maps "me"/"self"/the owner's name
   (`ownerWords`), and the builder checks Family Calendar and the brief for a self person counted twice. Saved
   interviews are fixed by a one-time Flock migration (`engine/migrate.ts`).
3. **The cook's dish limit** is the existing `cap` rule (`per_meal`), extended to a cook's **visit** (her morning =
   Breakfast + Lunch + boxes). Counted: each distinct dish cooked in the visit (a linked part once; a swap item and a box's
   own item count; staples rice/roti count). This build: setup saves it (not "won't make"), the planner prefers
   templates that fit, never drops parts, and notes an over-limit day in the plan. Stricter enforcement: follow-up.
4. **A hard swap's item is a planned dish for that person**: shown on the shared row ("Pancakes for Agastya"), counted
   for the cook, on the grocery list, in history and rotation, never next day. A swap may target and give a kind
   (rotating, e.g. Paratha) or an item. Today's soft swap with a frequency ("millets sometimes") stays its own kind.
5. **Several children who differ**: one combined question naming each ("What goes in Agastya's and Mira's boxes?");
   no per-person repeat feature in the Flock engine.
6. **Rule targets are a list** (one or more), each target typed kind / sub-kind / item / ingredient. `veg` = ingredient
   targets meat, fish; "only X or Y" / "require X or Y" = a list. Old rules migrate by resolving each item with
   `matchDish` (kind/item) else as an ingredient.

## 10. Contract between the two lanes (fixed before planning)

**Manifest (planner `flock.app.json` `setup[]`, read by Flock `engine/spec.ts` `Question`)**
- New optional field `recall?: string` on a question: its recall form, with `{{heard}}` where Flock puts what was
  already heard for it, in the family's words ("You mentioned {{heard}} for breakfast. Anything else?"). Flock asks
  `recall` (not `ask`) when the question has facts kept from earlier replies (`notes.mentioned`, generalised from A4b).
  A question with no `recall` keeps today's behaviour.
- Question ids after the change, in order: `pain`, `apps`, `mainApp`, `lunchWhere`, `cook`, `cookTime`, `otherDays`,
  `childSame`, `familyBreakfast`, `familyLunch`, `familyDinner`, `childMeals`, `differently`, `subscriptions`,
  `connectLater`, `orderFindings`, `final`. Removed: `people`, `cookingDays`, `kidsBreakfast`, `kidsLunch`,
  `kidsDinner`, `adultsBreakfast`, `adultsLunch`, `adultsDinner`, `diet`, `elders`, `rules`, `orderIn`.
- Facts: `lunchWhere: text`, `cook: text`, `cookTime: text`, `otherDays: text`, `childSame: text`,
  `childDiffers: list` (items `{ person, meals: ["Breakfast"|"Lunch"|"Dinner"], box: bool }`), `pastWeek.breakfast`,
  `pastWeek.lunch`, `pastWeek.dinner`, `childMeals: text`, `differently: text` (all `text` in their words unless said).
- `childMeals` has `when: "childDiffers"` (asked only when the list is non-empty); `childSame` has
  `when: "household.children"`.
- New placeholders Flock fills: `{{you}}` (the speaker addressed: "you"), `{{cookName}}` (her name, else "your cook"),
  `{{children}}` (the child's name, or names joined "Agastya and Mira"), `{{lunchKnown}}` (the weekday lunch line from
  known facts, speaker as "you", e.g. "On weekdays you and Ankita are at the office and Agastya is at school till 3;
  Dad has lunch at home."). Each has a `fallback` per spec.ts rules.

**Household facts (Flock → every app, `householdFor`)**
- `household.people` always contains the speaker: `{ name, relation: "self", group: "adult" }`.
- No list or `household.weekly` entry names a person `"me"`/`"I"`/`"myself"`: always the person's name.
- `household.speaker` stays (the name).

**Setup apply** (`apply_setup` op: `{ household, transcript }`) is unchanged in shape; the transcript's Q lines carry
the new question texts. The planner's setup reader is written against the content, not question ids.

## 11. Left to the builder

- Field names and storage of the new part types and rule targets; how `slots.kinds`' flags move.
- The migration's exact mapping from today's saved setups (library category rows → template part `words`; tag rules
  that name a kind → kind targets via `matchDish`).
- Drafting the catalog's `bare` list for owner review.
- How a "wet" sabzi is read for egg/cheese roll days.
- Recall wording per question (owner reviews the list of question texts before build).
