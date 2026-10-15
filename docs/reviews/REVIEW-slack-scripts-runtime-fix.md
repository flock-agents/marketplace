# Slack Connector — Runtime Script Failures (v1.0.2)

**Author:** Wire · **Date:** 2026-09-08 · **Branch:** `v2` (marketplace)

Blaze had the Slack connector attached and asked it to read new content. Every Slack
script failed. Root-caused to **three distinct bugs**, all fixed here.

## Bug 1 — Scripts source a `_shared/_helpers.sh` that does not exist at the install location

`_slack_helpers.sh` and `slack-exec.sh` did:

```bash
source "$(cd "$_HELPERS_DIR/../../_shared" && pwd)/_helpers.sh"
```

`_shared/_helpers.sh` only exists in the platform's **bundled** skills tree
(`crafo-claw/flock-app/skills/_shared/`). Slack is a **marketplace-only** skill —
`resolveSkillSourceDir()` installs it to `DATA_DIR/skills/slack` (`/app/data/skills/slack`),
where `../../_shared` resolves to `/app/data/skills/_shared`, which **does not exist**.

Reproduced:
```
$ bash /app/data/skills/slack/scripts/listChannels.sh
./_slack_helpers.sh: line 5: cd: /app/data/skills/slack/scripts/../../_shared: No such file or directory
./_slack_helpers.sh: line 5: /_helpers.sh: No such file or directory
```

Gmail/LinkedIn work only because they are **also bundled** (they resolve from
`SHARED_SKILLS_DIR`, which has `_shared`).

**Fix:** Slack only used one thing from that file — the `FLOCK_API` variable. Made the
scripts self-contained: define `FLOCK_API` inline (with the same localhost guard) and
drop the `_shared` source. Works whether installed from marketplace or bundled.

## Bug 2 — Per-function `.ts` files are recursive forwarders that shadow the real `.sh`

The executor prefers `.ts` over `.sh` on Unix
(`getSkillScriptExtensions() → [".ts",".sh",...]`). Slack shipped a `.ts` for every
function (`listChannels.ts`, `extractTokens.ts`, …) — but each one just **re-POSTs to
`/api/internal/skill-exec`** with the same `functionName`:

```
server runs listChannels.ts → POST skill-exec{fn:listChannels} → server runs listChannels.ts → …  (infinite recursion)
```

The **real** logic lives only in the `.sh` files. Compare gmail: only `gmail-exec.ts`
is a forwarder; `listInbox.ts` etc. are real implementations.

**Fix:** Deleted the 8 shadowing per-function `.ts` forwarders so the executor resolves
the real `.sh`. Kept `slack-exec.ts` (its forwarder role is correct, matching
`gmail-exec.ts`). Slack is Unix-only until real `.ts` ports are written (documented tradeoff;
same as any `.sh`-only skill path).

## Bug 3 — `slack-exec.sh` produced invalid JSON params

```bash
PARAMS="${2:-{}}"      # bash closes ${...} at the first '}' → with $2='{}' this yields '{}}'
```

`slack-exec.sh listChannels '{}'` → `PARAMS='{}}'` → `jq --argjson` rejects it → empty body
POSTed → skill-exec fails. **Fix:** explicit default:
```bash
PARAMS="${2:-}"; [ -z "$PARAMS" ] && PARAMS='{}'
```
(Note: the identical line exists in `gmail-exec.sh` — flagged separately, not touched here
to avoid changing a working skill.)

## Bug 4 — errors written to stdout are discarded by the executor

`_error_json` wrote its JSON to **stdout** and `exit 1`. But the skill executor returns a
script's **stdout only on exit 0**, and its **stderr on any non-zero exit**
(`skill-executor.ts:552-553`). So on the failure path the real error JSON (stdout) was
dropped and the agent got the generic `exec_error` with whatever noise was on stderr.

**Fix:** `_error_json` now writes to **stderr** and exits 1, so the executor surfaces the
real reason. This also means the entry scripts' `RESULT=$(_slack_api …)` capture (stdout
only) can never swallow an error — it lands on stderr and `set -e` aborts, reason already
delivered. Verified: no-auth now emits `{"error":true,"code":"NO_AUTH",...}` on **stderr**,
stdout clean.

## Bug 5 (platform, separate repo) — broken `curl` logging shim pollutes every `.sh` skill

`crafo-claw/flock-app/skills/_shared/bin/curl` (BL-247 outbound-HTTP logger, on PATH for
every skill exec with `OUTBOUND_LOG_PATH` set) has invalid bash on line 36:

```bash
_data_size=${#_args[$_i]:-0}   # "bad substitution" — ${#...} (length) can't take :- (default)
```

Every `curl -d <value>` call prints `bad substitution` to stderr and mis-logs the entry
(`url:""`, `req_size:0`). It does **not** block the request (the shim still runs real curl
and exits with its code), so it is invisible on the success path — the executor ignores
stderr on exit 0. But on any failure it contaminates the surfaced error. Gmail/LinkedIn
never hit it because their real logic is `.ts` (`fetch`), not `.sh` (`curl`).

**Fix (in crafo-claw):**
```bash
_dval="${_args[$_i]:-}"
_data_size=${#_dval}
```
Verified in isolation: no bad-substitution, correct `req_size`. **Requires a stage merge +
platform redeploy** — the deployed `/app/skills/_shared/bin/curl` is root-owned and can't be
hot-patched. Not a Slack blocker on the success path, but needed for clean error messages
across all `.sh`+`curl` skills.

## Verification
- `bash -n` clean on all 10 `.sh` scripts.
- Reproduced Bug 1 pre-fix; confirmed gone post-fix.
- No-auth path now surfaces JSON error (Bug 4 fix).
- Trace confirms `listChannels.sh` reaches `browser-fetch` token extraction + `conversations.list`.
- Live end-to-end (real Slack session) delegated to Blaze — the `skill-exec` endpoint enforces
  agent-binding, so it can only be exercised as the agent that owns the session.

## Files
- `skills/slack/scripts/_slack_helpers.sh` — inline `FLOCK_API`; fd-preserved `_error_json`
- `skills/slack/scripts/slack-exec.sh` — inline `FLOCK_API`; PARAMS default fix
- `skills/slack/scripts/{listChannels,listMessages,listThreadReplies,searchMessages,getUserInfo,listUsers,extractTokens,checkTokenHealth}.ts` — **deleted** (recursive shadows)
- `skills/slack/flock.skill.json`, `catalog.json` — version 1.0.1 → 1.0.2
