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

## License

Licensed under [BSL 1.1](LICENSE) — usable only with the Flock platform (flockagents.ai) or for personal, non-commercial purposes. Converts to Apache 2.0 four years after each release.
