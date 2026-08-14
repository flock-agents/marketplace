#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
PRODUCT_ID=$(echo "$PARAMS" | jq -r '.productId // ""')

_require_browser_session
_validate_param "$PRODUCT_ID" "productId"

CART_URL="${BASE_URL}/checkout"

REMOVE_EVAL_SCRIPT="(() => {
  const targetId = '${PRODUCT_ID}';
  const cartItems = document.querySelectorAll('[class*=\"cart-item\"], [class*=\"CartItem\"], [class*=\"cart_item\"], [data-testid=\"cart-item\"], [class*=\"CheckoutItem\"]');

  if (cartItems.length === 0) {
    return JSON.stringify({ error: true, code: 'CART_EMPTY', message: 'Cart has no items' });
  }

  let found = false;
  let removedName = '';

  cartItems.forEach(el => {
    if (found) return;
    const link = el.querySelector('a')?.href || '';
    const idMatch = link.match(/\\/prid\\/(\\d+)/) || link.match(/\\/product\\/([\\w-]+)/) || link.match(/\\/(\\d{5,})/);
    const itemId = idMatch ? idMatch[1] : '';

    if (itemId === targetId) {
      const nameEl = el.querySelector('[class*=\"name\"], [class*=\"Name\"], [class*=\"Title\"], h4, h3');
      removedName = (nameEl?.textContent || '').trim().substring(0, 200);

      const removeBtn = el.querySelector('[class*=\"remove\"], [class*=\"Remove\"], [class*=\"delete\"], [class*=\"Delete\"], [data-testid=\"remove-btn\"], button[aria-label*=\"remove\"], button[aria-label*=\"delete\"]');
      if (!removeBtn) {
        const minusBtn = el.querySelector('[class*=\"minus\"], [class*=\"Minus\"], button[aria-label*=\"decrease\"]');
        if (minusBtn) {
          const qtyEl = el.querySelector('[class*=\"quantity\"], [class*=\"count\"], input[type=\"number\"]');
          const qty = parseInt((qtyEl?.textContent || qtyEl?.value || '1').replace(/[^\\d]/g, '')) || 1;
          for (let i = 0; i < qty; i++) {
            minusBtn.click();
          }
          found = true;
          return;
        }
      } else {
        removeBtn.click();
        found = true;
      }
    }
  });

  if (!found) {
    return JSON.stringify({ error: true, code: 'PRODUCT_NOT_FOUND', message: 'Product ' + targetId + ' not found in cart' });
  }

  return new Promise(resolve => {
    setTimeout(() => {
      const countEl = document.querySelector('[class*=\"cart-count\"], [class*=\"CartCount\"], [class*=\"badge\"], [data-testid=\"cart-count\"]');
      const totalEl = document.querySelector('[class*=\"grand-total\"], [class*=\"GrandTotal\"], [class*=\"total-amount\"], [class*=\"TotalAmount\"], [data-testid=\"cart-total\"], [class*=\"ToPay\"]');
      const cartCount = parseInt((countEl?.textContent || '0').replace(/[^\\d]/g, '')) || 0;
      const totalText = (totalEl?.textContent || '').replace(/[^\\d.]/g, '');
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
  _error_json "PAGE_CHANGED" "Could not interact with cart. The service may have updated its layout."
}

IS_ERROR=$(echo "$PARSED" | jq -r '.error // false')
if [ "$IS_ERROR" = "true" ]; then
  echo "$PARSED"
  exit 1
fi

echo "$PARSED" | jq -c '.'
