#!/bin/bash
set -euo pipefail
SERVER="${FLOCK_SERVER_DIR:?set FLOCK_SERVER_DIR to <crafo-claw>/flock-app/server}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
H="/tmp/flock-test-envless-${USER:-unknown}"
ulimit -n 8192 2>/dev/null || ulimit -n 4096 2>/dev/null || true
cd "$HERE/../../.."
for t in "$HERE"/*.flock.test.ts; do
  FLOCK_SERVER_DIR="$SERVER" FLOCK_APP_DIR="$SERVER/.." FLOCK_HOME="$H" DATA_DIR="$H/data" FLOCK_TEST_ISOLATED="$H/data" TMUX_TMPDIR="$H/tmux" \
    bun test --preload "$SERVER/tests/helpers/preload.ts" "$t"
done
