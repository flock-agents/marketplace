#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
PRODUCT_ID=$(echo "$PARAMS" | jq -r '.productId // ""')
QUANTITY=$(echo "$PARAMS" | jq -r '.quantity // 1')

_require_browser_session
_validate_param "$PRODUCT_ID" "productId"

if ! [[ "$QUANTITY" =~ ^[0-9]+$ ]]; then QUANTITY=1; fi
if [ "$QUANTITY" -lt 1 ]; then QUANTITY=1; fi
if [ "$QUANTITY" -gt 10 ]; then
  _error_json "QUANTITY_LIMIT" "Maximum quantity per item is 10"
fi

PRODUCT_URL="${BASE_URL}/prn/product/prid/${PRODUCT_ID}"

SESSION_RESULT=$(_persistent_create "$PRODUCT_URL")
PERSISTENT_ID=$(echo "$SESSION_RESULT" | jq -r '.persistentSessionId // ""')

if [ -z "$PERSISTENT_ID" ]; then
  _error_json "SESSION_ERROR" "Failed to create persistent session"
fi

CHECK_ACTIONS=$(jq -nc '[
  {"action":"waitForSelector","selector":"[class*=\"AddToCart\"], [class*=\"add-to-cart\"], [data-testid=\"add-btn\"], button[class*=\"add\"], button[class*=\"Add\"], [class*=\"out-of-stock\"], [class*=\"OutOfStock\"]","delay":5000}
]')

CHECK_SCRIPT="(() => {
  const outOfStock = document.querySelector('[class*=\"out-of-stock\"], [class*=\"OutOfStock\"], [class*=\"sold-out\"], [class*=\"SoldOut\"], [class*=\"Unavailable\"]');
  if (outOfStock) {
    const nameEl = document.querySelector('[class*=\"name\"], [class*=\"Name\"], [class*=\"Title\"], h1, h2');
    const name = (nameEl?.textContent || 'This product').trim().substring(0, 200);
    return JSON.stringify({ error: true, code: 'OUT_OF_STOCK', message: name + ' is currently out of stock' });
  }
  const addBtn = document.querySelector('[class*=\"AddToCart\"], [class*=\"add-to-cart\"], [data-testid=\"add-btn\"], button[class*=\"add\"], button[class*=\"Add\"]');
  return JSON.stringify({ inStock: true, hasButton: !!addBtn });
})()"

CHECK_RESULT=$(_persistent_interact "$PERSISTENT_ID" "$CHECK_ACTIONS" "false" "$CHECK_SCRIPT")
CHECK_CONTENT=$(echo "$CHECK_RESULT" | jq -r '.content // "{}"')

IS_ERROR=$(echo "$CHECK_CONTENT" | jq -r '.error // false' 2>/dev/null || echo "false")
if [ "$IS_ERROR" = "true" ]; then
  _persistent_close "$PERSISTENT_ID"
  echo "$CHECK_CONTENT"
  exit 1
fi

ADD_SCRIPT="(() => {
  const quantity = ${QUANTITY};
  const addBtn = document.querySelector('[class*=\"AddToCart\"], [class*=\"add-to-cart\"], [data-testid=\"add-btn\"], button[class*=\"add\"], button[class*=\"Add\"]');
  if (!addBtn) {
    return JSON.stringify({ error: true, code: 'PAGE_CHANGED', message: 'Could not find add-to-cart button. The page layout may have changed.' });
  }

  for (let i = 0; i < quantity; i++) {
    addBtn.click();
  }

  return new Promise(resolve => {
    setTimeout(() => {
      const nameEl = document.querySelector('[class*=\"name\"], [class*=\"Name\"], [class*=\"Title\"], h1, h2');
      const cartCountEl = document.querySelector('[class*=\"cart-count\"], [class*=\"CartCount\"], [class*=\"badge\"], [data-testid=\"cart-count\"]');
      const cartTotalEl = document.querySelector('[class*=\"cart-total\"], [class*=\"CartTotal\"], [class*=\"total\"]');

      const name = (nameEl?.textContent || '').trim().substring(0, 200);
      const cartCount = parseInt((cartCountEl?.textContent || '').replace(/[^\\d]/g, '')) || 0;
      const totalText = (cartTotalEl?.textContent || '').replace(/[^\\d.]/g, '');
      const cartTotal = totalText ? parseFloat(totalText) : 0;

      resolve(JSON.stringify({
        success: true,
        productId: '${PRODUCT_ID}',
        name: name,
        quantityAdded: quantity,
        cartItemCount: cartCount,
        cartTotal: cartTotal
      }));
    }, 1500);
  });
})()"

ADD_ACTIONS=$(jq -nc '[
  {"action":"screenshot"}
]')

RESULT=$(_persistent_interact "$PERSISTENT_ID" "$ADD_ACTIONS" "true" "$ADD_SCRIPT")
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')

PARSED=$(echo "$CONTENT" | jq -c '.' 2>/dev/null) || {
  _error_json "PAGE_CHANGED" "Could not interact with the product page. The service may have updated its layout."
}

IS_ERROR=$(echo "$PARSED" | jq -r '.error // false')
if [ "$IS_ERROR" = "true" ]; then
  echo "$PARSED"
  exit 1
fi

echo "$PARSED" | jq -c '.'
