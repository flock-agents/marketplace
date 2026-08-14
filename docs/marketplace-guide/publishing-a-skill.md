# Publishing a Skill

Skills add capabilities to Flock agents — email management, grocery shopping, project tracking, and more. This guide covers everything you need to publish a skill to the marketplace.

## Directory Structure

```
skills/<slug>/
├── flock.skill.json      # Required: manifest
├── instructions.md       # Required: agent instructions
├── scripts/              # Optional: execution scripts
│   ├── my-function.sh
│   ├── my-function.ts
│   └── _helpers.sh
└── README.md             # Optional: human-readable docs
```

## Required Files

### flock.skill.json

The skill manifest. Everything about the skill lives here — the catalog only contains pointers.

```json
{
  "name": "My Skill",
  "slug": "my-skill",
  "icon": "🔧",
  "description": "One-line description of what the skill does",
  "version": "1.0.0",
  "author": "flock",
  "category": "integration",
  "tags": ["relevant", "search", "tags"],
  "minFlockVersion": "0.7.0",
  "tier": "installable",
  "requires": {
    "type": "browser_session",
    "service": "service-name",
    "description": "What the user needs to do to connect",
    "rationale": "Why this connection method is needed"
  }
}
```

#### Manifest Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name |
| `slug` | Yes | URL-safe identifier (lowercase, hyphens only) |
| `icon` | Yes | Emoji icon (see Icon Guidelines below) |
| `description` | Yes | One-line description (under 100 chars) |
| `version` | Yes | Semver version string |
| `author` | Yes | Publisher identifier (e.g., `"flock"`) |
| `category` | Yes | One of: `integration`, `productivity`, `lifestyle`, `family`, `professional` |
| `tags` | Yes | Array of search tags |
| `minFlockVersion` | Yes | Minimum Flock version required |
| `tier` | Yes | `"installable"` for marketplace skills |
| `requires` | Yes | Connection requirements (see below) |

#### Connection Requirements

Skills can require different connection types:

**Browser session** (for services without APIs):
```json
{
  "requires": {
    "type": "browser_session",
    "service": "zepto",
    "description": "Log in to Zepto via the dashboard browser session",
    "rationale": "Zepto has no public API — browser session required."
  }
}
```

**API key:**
```json
{
  "requires": {
    "auth": {
      "type": "api_key",
      "keys": ["SERVICE_API_KEY"],
      "setup_instructions": "Get your API key from..."
    }
  }
}
```

**Multiple methods** (with fallback):
```json
{
  "requires": {
    "anyOf": [
      { "type": "browser_session", "service": "google", "recommended": true },
      { "type": "account", "credentialSubtype": "imap", "service": "imap" }
    ]
  }
}
```

### instructions.md

The instructions file tells the agent how to use the skill. It has YAML frontmatter followed by markdown.

```markdown
---
name: My Skill
description: One-line description
category: integration
requiresInstance: true
auth:
  type: browser_session
  session_name: service-name
  setup_instructions: "How to connect"
tier: installable
---

# My Skill

What this skill does and when to use it.

## Available Functions

### function-name
Description. Params: `{ param: type }`

## Usage

How to invoke functions.

## Notes

Important behavior notes for the agent.
```

## Optional Files

### scripts/

Execution scripts that implement the skill's functions. Can be shell scripts (`.sh`), TypeScript (`.ts`), or Python (`.py`).

Naming conventions:
- Function scripts: `<function-name>.sh` / `<function-name>.ts`
- Helpers: `_helpers.sh`, `_<name>.sh` (prefixed with underscore)
- Entry point wrapper: `<skill-slug>-exec.sh` (if the skill has a unified entry point)

### README.md

Human-readable documentation for developers. Not used by the agent — purely for people browsing the repo.

## Icon Guidelines

Use emoji for now. Choose an icon that represents the skill's primary function:

- Email/messaging: 📧 ✉️
- Shopping/delivery: 🛒 📦 🧺
- Calendar/scheduling: 📅 🗓️
- Project management: 📐 📋
- Finance: 💰 💳
- Speed/instant: ⚡

Avoid generic icons — pick something that helps users identify the skill at a glance.

## Catalog Entry

After creating the skill, add an entry to `catalog.json`:

```json
{
  "slug": "my-skill",
  "type": "skill",
  "name": "My Skill",
  "description": "One-line description",
  "author": "flock",
  "category": "integration",
  "tags": ["relevant", "tags"],
  "icon": "🔧",
  "repo": "flock-agents/marketplace",
  "path": "skills/my-skill",
  "latestVersion": "1.0.0",
  "latestTag": "my-skill-v1.0.0",
  "minFlockVersion": "0.7.0",
  "publishedAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-01T00:00:00Z"
}
```

## Tagging Convention

Tags follow the format: `<slug>-v<version>`

```bash
git tag my-skill-v1.0.0
git push origin my-skill-v1.0.0
```

The tag name must match the `latestTag` field in `catalog.json`.

## What NOT to Include

- Secrets, tokens, API keys, or credentials
- `node_modules/` or other dependency directories
- Build artifacts (`dist/`, `.cache/`)
- User data or personal configuration
- Internal API URLs (use relative paths or env vars)
- Test fixtures with real data

## Testing Before Publish

Before publishing, verify:

1. `flock.skill.json` is valid JSON with all required fields
2. `instructions.md` has correct YAML frontmatter
3. All scripts are executable and have no hardcoded paths
4. No secrets or credentials in any file
5. The skill slug in `flock.skill.json` matches the directory name
6. The `latestTag` in `catalog.json` matches the git tag you'll create
7. The skill installs and works on a clean Flock instance
