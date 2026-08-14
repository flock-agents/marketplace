# Publishing a Template

Templates are pre-configured agent setups that bundle skills, apps, tasks, and identity into a ready-to-use package. When a user installs a template, they get a fully configured agent without manual setup.

## Directory Structure

```
templates/<slug>/
├── flock.template.json   # Required: manifest
├── CLAUDE.md             # Required: agent identity and instructions
├── skills/               # Optional: skill references or custom skill files
│   └── skill-refs.json
├── apps/                 # Optional: app references
│   └── app-refs.json
├── tasks/                # Optional: scheduled tasks
│   └── tasks.json
└── README.md             # Optional: developer docs
```

## Template Manifest

### flock.template.json

```json
{
  "name": "My Template",
  "slug": "my-template",
  "icon": "🤖",
  "description": "What this template sets up",
  "version": "1.0.0",
  "author": "flock",
  "category": "personal",
  "tags": ["relevant", "tags"],
  "minFlockVersion": "0.7.0",
  "includes": {
    "skills": ["gmail", "google-calendar"],
    "apps": ["meal-planner"],
    "tasks": [
      {
        "name": "Daily briefing",
        "schedule": "0 8 * * *",
        "prompt": "Summarize today's calendar and unread emails"
      }
    ]
  }
}
```

## What Templates Include

| Component | Description |
|-----------|-------------|
| **CLAUDE.md** | Agent identity, personality, and instructions |
| **Skills** | References to marketplace skills the template needs |
| **Apps** | References to marketplace apps to install |
| **Tasks** | Pre-configured scheduled tasks (cron jobs) |
| **Custom prompts** | Default conversation starters or workflows |

## How Templates Are Instantiated

1. User selects a template in the Flock dashboard
2. Flock creates a new agent with the template's CLAUDE.md
3. Referenced skills are installed (user is prompted to connect each one)
4. Referenced apps are installed and registered
5. Scheduled tasks are created with the specified cron schedules
6. The agent is ready to use

## Template Manifest Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name |
| `slug` | Yes | URL-safe identifier |
| `icon` | Yes | Emoji icon |
| `description` | Yes | One-line description |
| `version` | Yes | Semver version string |
| `author` | Yes | Publisher identifier |
| `category` | Yes | Category for discovery |
| `tags` | Yes | Search tags |
| `minFlockVersion` | Yes | Minimum Flock version |
| `includes` | Yes | What the template bundles (skills, apps, tasks) |

## Best Practices

- Keep CLAUDE.md focused — don't make the agent try to do everything
- Only reference skills that exist in the marketplace
- Set reasonable cron schedules — don't overwhelm with notifications
- Document what connections the user will need to set up
- Test the full template flow: create agent → connect skills → run tasks
