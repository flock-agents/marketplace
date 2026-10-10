# Pipeline

For deals that move through stages: sales leads, client proposals, orders, applications.
Start here when the owner says "track my deals", "pipeline", "leads" or "who are we waiting on".

## Data
One table (server/db/schema.ts) with the kit's `id`, `created_at`, `updated_at`, `updated_by`. Value is whole rupees.
- `deals`: `title`, `stage` (Lead, Talking, Proposal, Won, Lost), `owner`, `value`, `next_step`, `due` (ISO date of the next step).
  Agents must set `stage` to exactly one of the listed stages: a deal with any other stage has no lane and is left off the board and its count.

## Pages
- `board`: one lane per stage with the deals as cards. Dragging a card (or the Move to menu on a focused card) changes its stage. The strip above shows the value in each stage.
- Clicking a card or row opens the deal above the page: Edit, Delete (asks first, with Undo) and Close.
- `table`: every deal (soonest due first, no due date last), with search, a Stage filter, load more and an Add form.
- Two pages put the nav on top. The agent chat sits beside the page; the deal last clicked is sent as its context.

## What to change first
1. The stages: `STAGES` in server/db/constants.ts, and `STAGE_TONES` in src/pages/shared.ts.
   Renaming a column or table needs the owner's approval, so do it before the app has real rows. Changing the stage names only means updating existing rows.
2. The sample rows in server/db/seed.ts: replace them with the owner's real deals.
3. The page titles and nav names (each `label("title.<page>", …)` and `label("nav.<page>", …)`), the starter prompts in src/App.tsx and the accent (a name, one of coral, teal, blue, green, violet, amber; never a hex colour).
4. The object is `briefcase` (find others with find-object.sh).

## Name, accent, starters and labels
The app reads them at run time with `useApp()` from `display` in flock.app.json (`object`, `accent`, `starters`, `labels`), served at `/api/_app`;
the name is the app's registered name. What App.tsx passes after `??`, and the second argument of each `label(key, fallback)`, are only fallbacks:
when `display` sets a value, change it there, or the change in code never shows.

## Design updates
`src/flock/` (ui, theme, COMPONENTS.md, CHANGELOG.md, VERSION) belongs to the component library and is overwritten by `update-design.sh`.
Put the app's own CSS (for example an accent override such as `--ua: var(--ua-teal)`) outside it, such as `src/App.css`. App-only objects in `src/flock/objects/` are kept.

## Words the owner can change (labels)
`noun.one` / `noun.many` (default deal / deals) rename what a row is across the pages. `stage.<Value>` (stage.Lead, stage.Talking, stage.Proposal, stage.Won, stage.Lost) reword a stage for display only: the stored stage stays one of Lead, Talking, Proposal, Won, Lost, so agents always write those values. The value strip, card value and Value column appear only once some row has a value.
