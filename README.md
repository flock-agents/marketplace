# Flock Marketplace

The catalog and package repository for Flock skills, apps, and agent templates.

## Structure

```
catalog.json       Index of all published packages
skills/            Skill packages (one directory per skill)
apps/              App packages (one directory per app)
templates/         Agent template packages (one directory per template)
```

Each package directory contains its manifest (`flock.skill.json`, `flock.app.json`, or `flock.template.json`) and source files. The Flock platform fetches `catalog.json` to discover available packages and downloads individual package tarballs on install.

## Kit apps

Some apps under `apps/` (bookings, checklist, dashboard, directory, invoices, itinerary, money, pipeline, planner, tracker) are built on Flock's app kit and component library. Their `flock.app.json` says `"assemble": true`: before running the app's `buildCommand`, Flock copies the component library, theme and the manifest's `objects` into the app's `src/flock/` and fills in the app's id and name, then builds the package into a deployable bundle. The manifest also lists the app's `pages`, `tables`, `settings`, `labels` and `useCases` (what the app is for and not for, read by the Flock Assistant when it picks a starting point), and each kit app ships an `ARCHITECTURE.md`: a shared part (identical in all of them; source in `docs/marketplace-guide/kit-app-architecture.md`) followed by the app's own notes. The user owns the installed copy; an untouched copy follows the package and the library, a customized one updates only when the owner asks.

Packaging is the same as for every other app: `flock.app.json` and `flock.marketplace.json` agree on the semver `version` and `minFlockVersion`, `CHANGELOG.md` has an entry per version, the release is the tag `<name>-v<x.y.z>` plus the matching `catalog.json` entry. A retired app stays in the catalog with `deprecated: {since, replacedBy, note}`: new installs are refused, existing copies keep updating.

Run the kit apps' tests from a Flock checkout: `FLOCK_APP_SOURCES_DIR=<this clone>/apps bun run test:apps` (in `flock-app/`; on Flock 0.14 the names are `FLOCK_TEMPLATES_DIR` and `test:templates`).

## License

Licensed under [BSL 1.1](LICENSE) — usable only with the Flock platform (flockagents.ai) or for personal, non-commercial purposes. Converts to Apache 2.0 four years after each release.
