# Best Practices

## Self-Describing Manifests

Everything about a package should live with the package, not in the catalog. The catalog is a discovery index — the manifest is the source of truth.

- Put the icon, description, version, and requirements in `flock.skill.json` / `flock.app.json`
- The catalog entry is a pointer — if the manifest and catalog disagree, the manifest wins
- New fields should go in the manifest first, catalog second

## Relative Paths in Frontend Code

Apps are served under `/a/<slug>/`. All JavaScript API calls must use relative paths:

```javascript
// Correct
fetch("./api/data")
fetch("../shared/config")

// Wrong — escapes the app's URL scope
fetch("/api/data")
```

HTML `src` and `href` attributes and CSS `url()` references are auto-rewritten by the platform, but `fetch()` and `XMLHttpRequest` in JavaScript are not.

## No Hardcoded Ports

Backend processes receive their port via environment variable. Never hardcode a port number:

```typescript
// Correct
const port = process.env.PORT || 3000;

// Wrong
const port = 8080;
```

## Clean Separation of Data vs Code

- **Code** lives in the package directory — replaced on every update/redeploy
- **Data** lives in `$APP_DATA_DIR` — persists across updates
- Never store user data alongside code files
- Never store code in the data directory

```typescript
// Correct — data in $APP_DATA_DIR
const db = new Database(`${process.env.APP_DATA_DIR}/app.db`);

// Wrong — data in code directory (lost on redeploy)
const db = new Database("./data/app.db");
```

## Error Handling in Skills

Skills should handle errors gracefully and return structured error responses:

```json
{
  "error": true,
  "code": "AUTH_EXPIRED",
  "message": "Browser session has expired. Please reconnect via Skills & Integrations."
}
```

Guidelines:
- Return JSON errors, not stack traces
- Use meaningful error codes that the agent can act on
- Include user-facing messages the agent can relay
- Don't swallow errors silently — the agent needs to know what happened
- For auth failures, guide toward reconnection (never expose credentials in errors)

## Mobile-First for Apps

Flock apps are often accessed on mobile devices. Design accordingly:

- Use responsive layouts that work on 375px+ viewports
- Make tap targets at least 44x44px
- Avoid hover-dependent interactions
- Test on mobile viewport before publishing
- Keep navigation simple — no complex multi-level menus

## Testing Checklist Before Publish

### Skills

- [ ] `flock.skill.json` is valid JSON with all required fields
- [ ] `instructions.md` has correct YAML frontmatter
- [ ] Slug in manifest matches directory name
- [ ] All scripts run without errors on a clean system
- [ ] No hardcoded paths, secrets, or credentials
- [ ] No `node_modules/`, `dist/`, or build artifacts
- [ ] Connection requirements are documented in both manifest and instructions
- [ ] Error cases return structured JSON responses
- [ ] Rate limits are reasonable (if applicable)

### Apps

- [ ] `flock.app.json` is valid JSON with all required fields
- [ ] Frontend builds with `buildCommand`
- [ ] Backend starts and emits `readyPattern` (for fullstack apps)
- [ ] All API calls use relative paths
- [ ] No hardcoded ports
- [ ] Data persistence uses `$APP_DATA_DIR`
- [ ] Mobile viewport tested (375px+)
- [ ] Private apps work behind Flock auth
- [ ] No secrets in source files

### Templates

- [ ] `flock.template.json` is valid JSON
- [ ] CLAUDE.md is well-structured and focused
- [ ] All referenced skills exist in the marketplace
- [ ] All referenced apps exist in the marketplace
- [ ] Scheduled tasks have valid cron expressions
- [ ] Connection requirements are clearly documented

## General Rules

1. **One package, one purpose** — don't bundle unrelated functionality
2. **Instructions over comments** — the agent reads `instructions.md`, not code comments
3. **Fail loudly** — better to return an error than silently do nothing
4. **No internal URLs** — never reference `localhost`, internal IPs, or platform internals in instructions
5. **Keep it minimal** — include only what's needed for the skill to work
6. **Version everything** — even "small" changes get a version bump
7. **Tag before push** — the tag is what Flock fetches; the branch is secondary
