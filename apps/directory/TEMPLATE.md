# Directory

For a browsable set of people, places or things you look up by name or kind: trusted vendors, restaurants, contacts, a plant collection.
Start here when the owner says "keep a list of…" and each entry has a picture and a phone or link. It has a gallery of cards
with search and a kind filter (each card is a tinted cover with the kind's object when there is no picture), and a page per entry.

## Data
One table, `entries` (server/db/schema.ts), plus the kit's `id`, `created_at`, `updated_at`, `updated_by`.
`name` (required), `kind` (free text, default Other; suggested: Plumber, Electrician, Restaurant, Cafe, Tiffin service, Cleaning, Appliance repair, Nursery, Other), `image`
(an http(s) link or a /root-relative path; empty shows a placeholder), `phone`, `url`, `notes`.

## Pages
- `gallery` (src/pages/GalleryPage.tsx): cards, a search over name, kind and notes (done in the page), a kind filter (the suggestions plus every kind the entries use), and an Add form.
- `detail` (src/pages/DetailPage.tsx, route `#/entry/<id>`): the picture (or the kind's object when there is none), every field, an inline edit form, and Delete with a confirm and an Undo.
- The agent chat sits beside the page. The open entry is sent as its context.

## What to change first
1. The kinds are free text; `KINDS` in server/db/constants.ts are only the suggestions the form and the filter offer (the entries' own kinds join them). Edit the suggestions there, and the object drawn for each in `KIND_OBJECTS` (find objects with find-object.sh; add the ones you use to the app).
   Renaming a column or table needs the owner's approval, so change it before the app has real rows.
2. The seed entries in server/db/seed.ts: replace the neighbourhood services with the owner's real ones.
3. The page title (`label("title.gallery", "Directory")` in GalleryPage.tsx), the nav name (`label("nav.gallery", "All")`) and the starter prompts in App.tsx.
4. The accent (a name, one of coral, teal, blue, green, violet, amber; never a hex colour) and the header object (`phone`).

## Name, accent, starters and labels
The app reads them at run time with `useApp()` from `display` in flock.app.json (`object`, `accent`, `starters`, `labels`), served at `/api/_app`;
the name is the app's registered name. What App.tsx passes after `??`, and the second argument of each `label(key, fallback)`, are only fallbacks:
when `display` sets a value, change it there, or the change in code never shows.

## Design updates
`src/flock/` (ui, theme, COMPONENTS.md, CHANGELOG.md, VERSION) belongs to the component library and is overwritten by `update-design.sh`.
Put the app's own CSS (for example an accent override such as `--ua: var(--ua-teal)`) outside it, such as `src/App.css`. App-only objects in `src/flock/objects/` are kept.
