#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
PRODUCT_ID=$(echo "$PARAMS" | jq -r '.productId // ""')

_require_browser_session
_validate_param "$PRODUCT_ID" "productId"
_validate_id "$PRODUCT_ID" "productId"

CART_URL="${BASE_URL}/basket"

REMOVE_EVAL_SCRIPT="(() => {
  const targetId = '${PRODUCT_ID}';
  const cartItems = document.querySelectorAll('[class*=\"cart-item\"], [class*=\"CartItem\"], [class*=\"BasketItem\"], [data-testid=\"cart-item\"], [class*=\"itemlist\"] > div, [class*=\"ItemList\"] > div');

  let found = false;
  let removedName = '';

  cartItems.forEach(el => {
    if (found) return;
    const link = el.querySelector('a')?.href || '';
    const idMatch = link.match(/\\/pd\\/[\\w-]+\\/(\\d+)/) || link.match(/\\/(\\d{5,})/);
    const itemId = idMatch ? idMatch[1] : '';

    const nameEl = el.querySelector('[class*=\"name\"], [class*=\"Name\"], [class*=\"prod-name\"], h4, h3');
    const name = (nameEl?.textContent || '').trim().substring(0, 200);

    if (itemId === targetId) {
      const removeBtn = el.querySelector('[class*=\"remove\"], [class*=\"Remove\"], [class*=\"delete\"], [class*=\"Delete\"], [aria-label*=\"remove\"], [aria-label*=\"delete\"], button[class*=\"close\"]');
      if (removeBtn) {
        removeBtn.click();
        found = true;
        removedName = name;
      }
    }
  });

  if (!found) {
    return JSON.stringify({ error: true, code: 'PRODUCT_NOT_FOUND', message: 'Product ' + targetId + ' not found in cart' });
  }

  return new Promise(resolve => {
    setTimeout(() => {
      const cartCountEl = document.querySelector('[class*=\"cart-count\"], [class*=\"CartCount\"], [class*=\"badge\"], [class*=\"BasketCount\"]');
      const cartTotalEl = document.querySelector('[class*=\"cart-total\"], [class*=\"CartTotal\"], [class*=\"total\"], [class*=\"PayableAmount\"]');

      const cartCount = parseInt((cartCountEl?.textContent || '').replace(/[^\\d]/g, '')) || 0;
      const totalText = (cartTotalEl?.textContent || '').replace(/[^\\d.]/g, '');
      const cartTotal = totalText ? parseFloat(totalText) : 0;

      resolve(JSON.stringify({
        success: true,
        productId: targetId,
        removed: removedName,
        cartItemCount: cartCount,
        cartTotal: cartTotal
      }));
    }, 1500);
  });
})()"

RESULT=$(_browser_write "$CART_URL" "$REMOVE_EVAL_SCRIPT" "") || exit $?
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')

PARSED=$(echo "$CONTENT" | jq -c '.' 2>/dev/null) || {
  _error_json "PAGE_CHANGED" "Could not interact with the cart page. The service may have updated its layout."
}

IS_ERROR=$(echo "$PARSED" | jq -r '.error // false')
if [ "$IS_ERROR" = "true" ]; then
  echo "$PARSED"
  exit 1
fi

echo "$PARSED" | jq -c '.'
