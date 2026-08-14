# Flock Marketplace

The Flock Marketplace is a git-native, catalog-based distribution system for skills, apps, and templates that extend Flock agents.

## How It Works

1. **Packages live in this repo** — each skill, app, or template is a self-contained directory with a manifest and instructions
2. **`catalog.json`** is the index — Flock instances fetch this file to discover available packages, check versions, and trigger installs/updates
3. **Versions are git tags** — each release is tagged as `<slug>-v<version>` (e.g., `gmail-v1.0.0`), enabling Flock to fetch specific versions
4. **Install is a copy + register** — when a user installs a package, Flock clones the tagged version into the local skills/apps directory and registers it

## Types of Items

| Type | Directory | Manifest | Description |
|------|-----------|----------|-------------|
| **Skill** | `skills/<slug>/` | `flock.skill.json` | Adds capabilities to an agent (email, shopping, project management, etc.) |
| **App** | `apps/<slug>/` | `flock.app.json` | A hosted web app with optional backend — served by the Flock dashboard |
| **Template** | `templates/<slug>/` | `flock.template.json` | A pre-configured agent setup with skills, apps, tasks, and CLAUDE.md |

## Documentation

- [Publishing a Skill](publishing-a-skill.md)
- [Publishing an App](publishing-an-app.md)
- [Publishing a Template](publishing-a-template.md)
- [Updates & Versioning](updates-and-versioning.md)
- [Best Practices](best-practices.md)

## Quick Start

To publish a new skill:

```bash
# 1. Create the skill directory
mkdir -p skills/my-skill/scripts

# 2. Add required files
#    - flock.skill.json (manifest)
#    - instructions.md (agent instructions)
#    - scripts/ (execution scripts, if any)

# 3. Add to catalog.json

# 4. Commit, tag, and push
git add skills/my-skill catalog.json
git commit -m "Add my-skill v1.0.0"
git tag my-skill-v1.0.0
git push origin main --tags
```

See [Publishing a Skill](publishing-a-skill.md) for the full guide.
