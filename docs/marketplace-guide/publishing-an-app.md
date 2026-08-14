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
| `minFlockVersion` | Yes | Minimum Flock version |
| `type` | Yes | `"static"`, `"fullstack"`, or `"managed"` |
| `visibility` | Yes | `"public"` or `"private"` (private = requires Flock auth) |
| `buildCommand` | No | Shell command to build the frontend (must work via `sh -c`) |
| `processConfig` | No | Backend process config (fullstack apps only) |

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
