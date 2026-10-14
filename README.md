# Flock Marketplace

The catalog and package repository for Flock skills, apps, and agent templates.

## Structure

```
catalog.json       Index of all published packages
skills/            Skill packages (one directory per skill)
apps/              App packages (one directory per app)
templates/         Agent template packages (one directory per template)
app-templates/     App template packages (one directory per template)
```

Each package directory contains its manifest (`flock.skill.json`, `flock.app.json`, or `flock.template.json`) and source files. The Flock platform fetches `catalog.json` to discover available packages and downloads individual package tarballs on install.

## App templates

`app-templates/<name>/` is the source of a Flock app template: the app's code, its sample rows, its own tests, `TEMPLATE.md`, `CHANGELOG.md` and `bun.lock`. Flock installs the package, builds it with its own app kit and components, and makes apps from it. The user owns the copy.

Each template carries:

- `template.json` with a semver `version`, the platform's description of the template;
- `flock.marketplace.json` with `name`, `version` (the same semver) and `minFlockVersion`;
- a `CHANGELOG.md` entry per version.

A release is a tag `<name>-v<x.y.z>`, cut by hand on merge like every other item here, plus the matching entry in `catalog.json` (`type: "app-template"`, `template: "<name>"`, `path: "app-templates/<name>"`). A retired template stays in the catalog with `deprecated: {since, replacedBy, note}`: new installs are refused, existing copies keep updating.

Run the tests from a Flock checkout: `FLOCK_TEMPLATES_DIR=<this clone>/app-templates bun run test:templates` (in `flock-app/`).

## License

Licensed under [BSL 1.1](LICENSE) — usable only with the Flock platform (flockagents.ai) or for personal, non-commercial purposes. Converts to Apache 2.0 four years after each release.
