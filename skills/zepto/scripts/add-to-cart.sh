#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
QUERY=$(echo "$PARAMS" | jq -r '.query // ""')
QUANTITY=$(echo "$PARAMS" | jq -r '.quantity // 1')

_require_browser_session
_validate_param "$QUERY" "query"

if ! [[ "$QUANTITY" =~ ^[0-9]+$ ]]; then QUANTITY=1; fi
if [ "$QUANTITY" -lt 1 ]; then QUANTITY=1; fi
if [ "$QUANTITY" -gt 10 ]; then
  _error_json "QUANTITY_LIMIT" "Maximum quantity per item is 10"
fi

ENCODED_QUERY=$(printf '%s' "$QUERY" | jq -sRr @uri)
SEARCH_URL="${BASE_URL}/search?query=${ENCODED_QUERY}"
SAFE_QUERY_JS=$(printf '%s' "$QUERY" | jq -Rs '.')

SESSION_RESULT=$(_persistent_create "$SEARCH_URL" "$(jq -nc '[
  {"action":"wait","delay":3000},
  {"action":"scroll","deltaY":300},
  {"action":"wait","delay":1000}
]')")
PERSISTENT_ID=$(echo "$SESSION_RESULT" | jq -r '.persistentSessionId // ""')

if [ -z "$PERSISTENT_ID" ]; then
  _error_json "SESSION_ERROR" "Failed to create persistent session"
fi

ADD_SCRIPT="(() => {
  const quantity = ${QUANTITY};
  const searchQuery = ${SAFE_QUERY_JS};

  const allButtons = Array.from(document.querySelectorAll('button'));
  const addBtn = allButtons.find(btn => {
    const text = (btn.textContent || '').trim().toUpperCase();
    return text === 'ADD' || text === 'ADD TO CART';
  });

  if (!addBtn) {
    return JSON.stringify({ error: true, code: 'NO_PRODUCTS', message: 'No products with ADD button found in search results' });
  }

  addBtn.scrollIntoView({ block: 'center' });
  addBtn.click();

  if (quantity > 1) {
    let remaining = quantity - 1;
    const clickPlus = () => {
      if (remaining <= 0) return;
      const plusBtns = Array.from(document.querySelectorAll('button')).filter(btn =>
        (btn.textContent || '').trim() === '+'
      );
      if (plusBtns.length > 0) {
        plusBtns[0].click();
        remaining--;
        if (remaining > 0) setTimeout(clickPlus, 300);
      }
    };
    setTimeout(clickPlus, 800);
  }

  const resolveDelay = 2000 + Math.max(0, quantity - 1) * 400;
  return new Promise(resolve => {
    setTimeout(() => {
      const card = addBtn.closest('[data-testid=\"product-card\"], [class*=\"product\"], [class*=\"Product\"], a');
      const nameEl = card?.querySelector('[class*=\"name\"], [class*=\"Name\"], [class*=\"title\"], [class*=\"Title\"], h3, h4') || card;
      const name = (nameEl?.textContent || '').trim().substring(0, 200);

      const link = card?.closest('a')?.href || card?.querySelector('a')?.href || '';
      const idMatch = link.match(/\\/pvid\\/([^\\/?#]+)/) || link.match(/\\/pn\\/([^\\/?#]+)/);
      const productId = idMatch ? idMatch[1] : '';

      const cartCountEl = document.querySelector('[class*=\"cart-count\"], [class*=\"CartCount\"], [class*=\"cartCount\"], [class*=\"badge\"], [data-testid=\"cart-count\"]');
      const cartTotalEl = document.querySelector('[class*=\"cart-total\"], [class*=\"CartTotal\"], [class*=\"cartTotal\"], [class*=\"total\"]');

      const cartCount = parseInt((cartCountEl?.textContent || '').replace(/[^\\d]/g, '')) || 0;
      const totalText = (cartTotalEl?.textContent || '').replace(/[^\\d.]/g, '');
      const cartTotal = totalText ? parseFloat(totalText) : 0;

      resolve(JSON.stringify({
        success: true,
        productId: productId,
        name: name,
        query: searchQuery.substring(0, 200),
        quantityAdded: quantity,
        cartItemCount: cartCount,
        cartTotal: cartTotal
      }));
    }, resolveDelay);
  });
})()"

ADD_ACTIONS=$(jq -nc '[
  {"action":"screenshot"}
]')

RESULT=$(_persistent_interact "$PERSISTENT_ID" "$ADD_ACTIONS" "true" "$ADD_SCRIPT")
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')

PARSED=$(echo "$CONTENT" | jq -c '.' 2>/dev/null) || {
  _error_json "PAGE_CHANGED" "Could not interact with the search results page. The service may have updated its layout."
}

IS_ERROR=$(echo "$PARSED" | jq -r '.error // false')
if [ "$IS_ERROR" = "true" ]; then
  echo "$PARSED"
  exit 1
fi

echo "$PARSED" | jq -c '.'
