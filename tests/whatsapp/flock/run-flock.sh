#!/bin/bash
set -euo pipefail
if [ -z "${FLOCK_SERVER_DIR:-}" ]; then
  echo "skipped: set FLOCK_SERVER_DIR to <crafo-claw>/flock-app/server to run the WhatsApp connector inside Flock"
  exit 0
fi
if [ "$(uname)" != "Darwin" ]; then
  echo "skipped: these runs refuse the server's direct network with macOS sandbox-exec"
  exit 0
fi
SERVER="$(cd "$FLOCK_SERVER_DIR" && pwd)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
H="/tmp/flock-test-envless-${USER:-unknown}"
mkdir -p "$H/data" "$H/tmux"
chmod 700 "$H" "$H/data" "$H/tmux"
ulimit -n 8192 2>/dev/null || ulimit -n 4096 2>/dev/null || true
cd "$HERE/../../.."
for t in "$HERE"/*.flock.test.ts; do
  env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u FLOCK_HOST_KEY \
    FLOCK_SERVER_DIR="$SERVER" FLOCK_APP_DIR="$SERVER/.." FLOCK_HOME="$H" DATA_DIR="$H/data" FLOCK_TEST_ISOLATED="$H/data" TMUX_TMPDIR="$H/tmux" \
    bun test --timeout 120000 --preload "$SERVER/tests/helpers/preload.ts" "$t"
done
