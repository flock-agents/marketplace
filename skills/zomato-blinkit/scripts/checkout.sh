#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_helpers.sh"
source "$(dirname "$0")/../../_shared/smart-checkout.sh"
source "$(dirname "$0")/../../_shared/checkout.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
PERSISTENT_ID=$(echo "$PARAMS" | jq -r '.persistentSessionId // ""')

_require_browser_session

CHECKOUT_ACTIONS=$(jq -nc '[
  {"action":"evaluate","script":"(() => { const btn = Array.from(document.querySelectorAll(\"button, a\")).find(el => /proceed|checkout|place.order/i.test(el.textContent)); if (btn) { btn.scrollIntoView({block:\"center\"}); btn.click(); return \"clicked_proceed\"; } return \"no_proceed_button\"; })()"},
  {"action":"wait","delay":3000},
  {"action":"evaluate","script":"(() => { const btn = Array.from(document.querySelectorAll(\"button, a, div[role=button]\")).find(el => /pay\\s*online|online.payment|upi|net.banking/i.test(el.textContent)); if (btn) { btn.scrollIntoView({block:\"center\"}); btn.click(); return \"clicked_payment_method\"; } return \"no_payment_method\"; })()"},
  {"action":"wait","delay":2000},
  {"action":"evaluate","script":"(() => { const btn = Array.from(document.querySelectorAll(\"button, a, div[role=button]\")).find(el => /pay\\s*₹|pay\\s*now|place.order|confirm|make.payment/i.test(el.textContent)); if (btn) { btn.scrollIntoView({block:\"center\"}); btn.click(); return \"clicked_pay\"; } return \"no_pay_button\"; })()"},
  {"action":"wait","delay":5000}
]')

CAPTURE_CONFIG=$(_build_capture_config)

_run_checkout_flow "$PERSISTENT_ID" "https://blinkit.com/cart" "$CHECKOUT_ACTIONS" "blinkit" "$CAPTURE_CONFIG"
