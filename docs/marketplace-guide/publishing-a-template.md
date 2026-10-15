# Publishing a Template

A template is a pre-configured agent: identity, instructions, the connectors it needs, the apps it
pairs, and any routines it creates. Installing one gives the user a working agent instead of a
blank one.

Templates are **hand-authored**. There is no `packageTemplate` helper (unlike skills and apps) —
you write the two files below, add a catalog entry, and tag.

## Directory structure

```
templates/<slug>/
├── flock.template.json   # required — the manifest
├── SOUL.md               # required in practice — becomes the agent's instructions
├── icon.svg              # optional — see "Icons" below
└── README.md             # optional — developer notes, never read by Flock
```

`SOUL.md` is read verbatim and becomes the agent's instructions (`agent.claudeMd`). Without it the
agent falls back to a generated one-liner — `"You are <name>, a <role>."` — which is never what you
want. **It is not called `CLAUDE.md`.**

## flock.template.json

The loader is `manifestToUseCaseTemplate()` in `assistant-marketplace.ts`; the type is
`FlockTemplateManifest` in `types/marketplace.ts`. Those two are the source of truth — this
document describes them, and where they disagree, they win.

```json
{
  "name": "Inbox Assistant",
  "slug": "inbox-assistant",
  "description": "Watches your inbox and drafts the replies that need writing.",
  "version": "1.0.0",
  "author": "flock",
  "icon": "icon.svg",
  "category": "professional",
  "tags": ["email", "gmail", "drafting"],
  "minFlockVersion": "0.7.0",
  "sortOrder": 20,

  "agent": {
    "defaultName": "Inbox Assistant",
    "model": "claude-haiku-4-5-20251001",
    "role": "main",
    "tone": "warm, concise, gets to the point",
    "examplePrompts": ["What in my inbox still needs a reply from me?"]
  },

  "skills": [
    {
      "skillId": "gmail",
      "preSelected": true,
      "description": "Read your mail and draft replies into Gmail",
      "accountRequirement": {
        "type": "oauth",
        "provider": "google",
        "setupGuide": "Connect your Google account"
      }
    }
  ],

  "apps": [{ "slug": "email-desk", "required": true }],
  "channels": [],
  "tasks": [],

  "wizard": [
    { "id": "personality", "type": "personality", "label": "Personality" },
    { "id": "skills", "type": "skills", "label": "Email" },
    { "id": "review", "type": "review", "label": "Review & Create" }
  ],

  "setupChecklist": [
    {
      "id": "connect-sources",
      "label": "Connect your mailbox",
      "deepLink": "/agents/:id?tab=skills",
      "skills": ["gmail"]
    }
  ]
}
```

### Fields

| Field | Required | Notes |
|-------|----------|-------|
| `name`, `slug`, `description`, `version`, `author` | Yes | `validateTemplateManifest` rejects the install without these |
| `agent.defaultName`, `agent.model`, `agent.role` | **Yes** | Missing any one makes the loader return `null` — the template silently never appears |
| `agent.tone`, `agent.examplePrompts`, `agent.personalityOptions` | No | `examplePrompts` become the starter chips |
| `category` | No | **Must be `personal`, `family` or `professional`** — see Categories |
| `icon` | No | A bare filename (`icon.svg`) or an emoji. See Icons |
| `sortOrder` | No | Lower sorts first in the picker |
| `skills[]` | No | `{skillId, preSelected?, description?, accountRequirement?}`. `preSelected` defaults to **true**; set `false` for an optional suggestion. `accountRequirement` is display-only (a badge and setup hint) |
| `apps[]` | No | `{slug, required?}`. Declaring an app is what **pairs** it. Grants come from the app's own manifest — never restate them |
| `useCaseSkills[]` | No | Newer path: installing one provisions its whole use case (app(s) + routines + deps) |
| `channels[]` | No | e.g. a Telegram bot token binding |
| `tasks[]` | No | Cron routines created on the agent. Omit if a declared app already owns its routines |
| `wizard[]` | No | Defaults to personality → skills → channels → scheduled-tasks → review |
| `setupChecklist[]` | No | See Checklist items |
| `defaultAccessPolicy` | No | Inbound allowlist / outbound push defaults |

Note `grantedSkills` on an `apps[]` entry is **dropped** by the loader — a marketplace template
cannot narrow an app's grants. The app's own `config.requires.skills` always applies.

### Categories

Only `personal`, `family` and `professional` exist (`TEMPLATE_CATEGORIES`). Any other value is a
silent trap with two different failure modes:

- once installed, the loader coerces the unknown value to `personal` — it files under the wrong tab
- while still uninstalled, the picker passes the catalog value through raw, so it matches no tab and
  is reachable only under "All"

### Icons

Set `icon` to a **bare filename** (`icon.svg`) or an emoji (`🏠`). Flock builds the URL itself from
`repo` + the branch it is serving + `path` + `icon`, and serves it through a same-origin proxy — so
a relative filename is all it ever needs. Do not hand-write a full `https://raw.githubusercontent…`
URL: it is not read for file icons, and it goes stale the moment a branch changes.

### Checklist items

An item only completes on its own if its `id` has a resolver in `checklist-resolvers.ts`. Today
those are:

`identity-configured` · `instructions-set` · `connect-sources` · `install-email-desk`
(and the legacy alias `install-draft-desk`) · `review-tasks`

Any other id has no reality source and will sit pending until manually ticked. Prefer the ids
above. `connect-sources` accepts a `skills: [...]` array to narrow which connections satisfy it;
`install-email-desk` reads the template's own `apps[]`, so it works for any declared app.

## How a template is instantiated

1. The user picks it; if it is not installed, Flock downloads the tarball for `latestTag`
2. `instantiateTemplate()` creates the agent, writes `SOUL.md` and `USER.md`
3. Pre-selected `skills[]` are installed and attached
4. `apps[]` are installed if missing, then **provisioned and paired** to the new agent, granting the
   skills each app's own manifest declares
5. `useCaseSkills[]` are expanded into their apps and routines
6. `tasks[]` become cron jobs or event routines

Steps 3–6 are **fail-soft**: a failure is reported per item and never costs the user their agent.

An app's own routines are materialized separately. A **scheduled** app routine (no
`trigger.connectorId`) is created at pair time, so it is visible before any account exists. An
**event** app routine (with a `trigger.connectorId`) is created **per connected account** — so the
agent's routines page is legitimately empty until the user connects one.

## Onboarding card and Personal Assistant

Both fields live in `catalog.json` only, never in the manifest. Flock reads them from the catalog
before anything is installed.

- `onboardingCard` on a template adds a card to the onboarding Problems step. Picking it sets up
  that template's agent. It carries `id`, `label`, `description`, `emoji`, `order`, and optionally
  `agentName` and `services` (the sign-ins the agent needs).
- `personalAssistant` on an app joins that app to the Personal Assistant, either always
  (`always: true`) or when the card whose id matches `useCase` is picked. Its `skills` are added to
  the assistant.

## Publishing

1. Bump `version` in `flock.template.json` (major = breaking, minor = new capability, patch = fix)
2. Update the entry in `catalog.json`: `latestVersion`, `latestTag`, `updatedAt`, and the top-level
   `updatedAt`
3. Commit to the branch Flock serves (**`v2`**)
4. Tag `<slug>-v<version>` at that commit and push the tag — the installer downloads
   `tarball/<latestTag>`, so **a missing tag means a broken install**

Never rename a `slug`: identity is `(type, storageKey)`, and renaming orphans every existing
install.

## Checklist before you publish

- [ ] `agent.defaultName`, `agent.model` and `agent.role` are all present
- [ ] `category` is one of `personal` / `family` / `professional`
- [ ] `icon` is a bare filename or an emoji — not a full URL
- [ ] `SOUL.md` exists (not `CLAUDE.md`)
- [ ] Every `setupChecklist` id has a resolver, or is deliberately manual
- [ ] `catalog.json` and the manifest agree on version and category
- [ ] The tag exists on the remote and matches `latestTag`
