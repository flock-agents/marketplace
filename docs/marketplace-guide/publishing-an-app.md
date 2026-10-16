# Publishing an App

Apps are hosted web applications served by the Flock dashboard. They can be static sites, SPAs, or full-stack apps with a backend.

## Directory Structure

```
apps/<slug>/
├── flock.app.json        # Required: manifest
├── frontend/             # Required: frontend source
│   ├── index.html
│   ├── src/
│   └── package.json
├── server/               # Optional: backend source (for fullstack apps)
│   ├── index.ts
│   └── routes/
├── shared/               # Optional: shared types between frontend/backend
│   └── types.ts
└── README.md             # Optional: developer docs
```

## Required Files

### flock.app.json

```json
{
  "name": "My App",
  "slug": "my-app",
  "icon": "🎯",
  "description": "What this app does",
  "version": "1.0.0",
  "author": "flock",
  "category": "lifestyle",
  "tags": ["relevant", "tags"],
  "minFlockVersion": "0.7.0",
  "type": "fullstack",
  "visibility": "private",
  "buildCommand": "cd frontend && npm install && npm run build",
  "processConfig": {
    "command": "bun run server/index.ts",
    "readyPattern": "listening on port"
  }
}
```

#### Manifest Fields

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
| `minFlockVersion` | Yes | Minimum Flock version. An app whose own code calls an SDK API newer than this also puts it in `flock.app.json` (see "Talking to the paired agent") |
| `type` | Yes | `"static"`, `"fullstack"`, or `"managed"` |
| `visibility` | Yes | `"public"` or `"private"` (private = requires Flock auth) |
| `buildCommand` | No | Shell command to build the frontend (must work via `sh -c`) |
| `processConfig` | No | Backend process config (fullstack apps only) |
| `assemble` | No | `true` for an app built on Flock's app kit: Flock copies the component library into `src/flock/` before `buildCommand` (see "Kit apps") |
| `useCases` | No | `{ "for": [...], "notFor": [...] }`: what the app is right for and wrong for, read by the Flock Assistant when it picks a starting point |
| `usage` | No | `"app"` (default) or `"template"`: whether the package is installed once or used as an app template (see "App or app template") |

## App or app template

`usage` says how an owner takes the package. `"app"` (the default when the field is absent) is installed once: the Marketplace lists it under **Apps** with an Install button, one copy per Flock, updated from the marketplace. `"template"` is an *app template*: never installed as it is, but used to make the owner's own app, named and filled for their purpose (the ten kit apps are templates). The Marketplace lists it under **App templates** with a **Use template** button that opens the Use dialog (icon, name, what it is for, the agent it works with), and the Flock Assistant plans an app from it on a card that reads "From the <name> template". An app made from a template keeps receiving the template's improvements until the owner changes how the app itself works. The owner can also use an `"app"` package as a template (**Use as template** in its row), so a plain app gets the same copy with "app" in place of "template". Put the field in `flock.app.json` and on the catalog item; adding it is not a version bump.

## Kit apps

An app built on Flock's app kit and component library (`@flock/app-kit`, `@flock/ui`) is published like any other app, with three additions:

- **`"assemble": true`** in `flock.app.json`. The package ships without the library; at build time Flock copies `@flock/ui`, the theme and the objects named in the manifest's `objects` into `src/flock/`, fills in the app's id and name, supplies `@flock/app-kit` and `@flock/app-sdk` into `node_modules`, and only then runs `buildCommand`. The manifest also carries the kit fields (`pages`, `tables`, `objects`, `nav`, `chat`, `labels`, `settings`, `privateTables`, `titleFromName`) and the platform fields the build relies on (`type: "fullstack"`, `access: "private"`, `spa`, `apiPrefix`, `buildDir`, `deployDir`, `processConfig`, `config.requires.agent`); copy them from an existing kit app and do not change them.
- **`useCases`**: three to five concrete requests the app is right for (`for`) and two or three it is wrong for (`notFor`), each naming the better app where there is one. The Flock Assistant chooses the closest starting point from these, so write them as an owner would ask ("Let clients book appointment slots at a clinic"), not as features.
- **`ARCHITECTURE.md`**: the shared kit architecture (request lifecycle, where the UI, API and data layers live, how to add a page, a table, a setting or a routine, samples and import, what must not be edited), copied verbatim from `docs/marketplace-guide/kit-app-architecture.md`, followed by a section on this app: its tables and columns, its pages, its own routes and what to change first. The paired agent reads it before changing the app, so keep it current with the code.

The package also carries `settings.json` (the declarative rules for each setting), `row-schema.json` (generated from `server/db/schema.ts`), `e2e-rows.json` (the end-to-end import fixture), its own tests (`tests/` runnable from the package, `server/*.test.ts` run inside the built app) and `bun.lock`. The rest of the packaging (two manifests agreeing on the version, a changelog entry per version, the `<slug>-v<x.y.z>` tag, the catalog entry) is unchanged.

#### App Types

- **static** — Pure HTML/CSS/JS, no backend. Served as-is.
- **fullstack** — Frontend + backend process. Backend gets its own port, proxied under `/a/<slug>/api/`.
- **managed** — Framework-managed (e.g., Next.js with `output: "standalone"`). Handles its own routing.

### processConfig (fullstack apps)

```json
{
  "command": "bun run server/index.ts",
  "readyPattern": "listening on port"
}
```

- `command`: The shell command to start the backend
- `readyPattern`: A string the platform watches for in stdout to confirm the backend is ready

## Build Command Requirements

- Must work when run via `sh -c "<buildCommand>"` from the app's root directory
- Should install dependencies (e.g., `npm install && npm run build`)
- Output should go to a predictable location (e.g., `frontend/dist/`)
- Must be idempotent — running twice should produce the same result

## Talking to the paired agent

A kit app that declares `"chat"` in `flock.app.json` (the kit apps say `"chat": "side"`) gets the in-app chat from the kit: nothing to write. On Flock 0.15.0 and later the kit
sends each message with `platform.agent.message` and the agent's replies are **pushed** back to the app, retried until the app takes
them, with no reply time limit (on an older Flock the same app keeps the older streamed reply). The package needs no code for this:
`@flock/app-kit` and `@flock/app-sdk` come from the Flock that builds the app.

An app that talks to its agent from its **own** code (a managed app on `@flock/app-sdk`) uses the same channel:

```ts
import { createFlockApp, type ChannelEvent } from "@flock/app-sdk";

const flock = createFlockApp({
  // Delivery is at least once and in order per session: skip an eventId you have already handled.
  onChannelEvent: async (e: ChannelEvent) => { /* e.type: turn.started | message | turn.ended | turn.failed | notice */ },
});
const sent = await flock.platform.agent.message({ userId: "<who is talking>", message: "…" });   // 202: the reply comes as events
```

Such an app needs Flock 0.15.0 (`CHAT_CHANNEL_MIN_FLOCK` in the SDK), and says so in **all three** places: `flock.app.json`,
`flock.marketplace.json` and its catalog entry (`"minFlockVersion": "0.15.0"` or later). Flock 0.15.0+ refuses to install or register it
from `flock.app.json`; older Flocks read only the other two. `check-app` reports an app that uses the channel without it.

## Data Persistence

Apps that need to store data should use the `$APP_DATA_DIR` environment variable:

```typescript
import { Database } from "bun:sqlite";
const db = new Database(`${process.env.APP_DATA_DIR}/app.db`);
```

- `$APP_DATA_DIR` is durable across redeploys
- NEVER store data in the served directory — redeploys replace it wholesale
- Use bun:sqlite at `$APP_DATA_DIR/app.db` for structured data

## Relative API Paths

Frontend code must use **relative paths** for API calls:

```typescript
// Correct — works under /a/<slug>/
fetch("./api/items")

// Wrong — escapes the app scope
fetch("/api/items")
```

HTML and CSS absolute paths are auto-rewritten at serve time, but JavaScript `fetch()` calls are not.

## Icon Guidelines

Same as skills — use emoji that represents the app's primary function.

## Version Numbering and Tagging

Same convention as skills: `<slug>-v<version>`

```bash
git tag my-app-v1.0.0
git push origin my-app-v1.0.0
```

## Testing Before Publish

1. Build the frontend locally — verify it compiles
2. Start the backend locally — verify it listens
3. Open the app in a browser — verify all pages render
4. Test all API endpoints — verify they return expected data
5. Check for hardcoded ports or absolute paths
6. Verify `$APP_DATA_DIR` is used for persistence (not local files)
7. Test on mobile viewport — apps should be mobile-first
8. Verify no secrets in source files
