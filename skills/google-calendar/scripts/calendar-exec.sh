#!/bin/bash
# google-calendar skill execution wrapper: routes through the Flock server (_shared/skill-exec.sh),
# under the same bash it was started with (macOS /bin/bash 3.2 included).
set -euo pipefail
exec "$BASH" "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../_shared" && pwd)/skill-exec.sh" google-calendar "$@"
