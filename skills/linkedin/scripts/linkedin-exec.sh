#!/bin/bash
# linkedin skill execution wrapper: `linkedin-exec.sh <command> [args...]` through the Flock server
# (_shared/skill-run.sh), under the same bash it was started with (macOS /bin/bash 3.2 included).
set -euo pipefail
exec "$BASH" "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../_shared" && pwd)/skill-run.sh" linkedin "$@"
