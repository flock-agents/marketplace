#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_helpers.sh"

_require_browser_session

CART_URL="${BASE_URL}/checkout"

EVAL_SCRIPT="(() => {
  const items = [];
  const cartItems = document.querySelectorAll('[class*=\"cart-item\"], [class*=\"CartItem\"], [class*=\"cart_item\"], [data-testid=\"cart-item\"], [class*=\"CheckoutItem\"]');

  cartItems.forEach(el => {
    const nameEl = el.querySelector('[class*=\"name\"], [class*=\"Name\"], [class*=\"Title\"], h4, h3');
    const qtyEl = el.querySelector('[class*=\"quantity\"], [class*=\"Quantity\"], [class*=\"count\"], input[type=\"number\"]');
    const priceEl = el.querySelector('[class*=\"price\"], [class*=\"Price\"], [class*=\"rupee\"]');
    const imgEl = el.querySelector('img');

    const name = (nameEl?.textContent || '').trim().substring(0, 200);
    if (!name) return;

    const qtyText = (qtyEl?.textContent || qtyEl?.value || '1').replace(/[^\\d]/g, '');
    const priceText = (priceEl?.textContent || '').replace(/[^\\d.]/g, '');
    const qty = parseInt(qtyText) || 1;
    const price = priceText ? parseFloat(priceText) : 0;

    const link = el.querySelector('a')?.href || '';
    const idMatch = link.match(/\\/prid\\/(\\d+)/) || link.match(/\\/product\\/([\\w-]+)/) || link.match(/\\/(\\d{5,})/);

    items.push({
      productId: idMatch ? idMatch[1] : '',
      name: name,
      quantity: qty,
      price: price,
      subtotal: price * qty
    });
  });

  const subtotalEl = document.querySelector('[class*=\"subtotal\"], [class*=\"Subtotal\"], [class*=\"sub-total\"]');
  const deliveryFeeEl = document.querySelector('[class*=\"delivery-fee\"], [class*=\"DeliveryFee\"], [class*=\"delivery_fee\"], [class*=\"handling\"]');
  const discountEl = document.querySelector('[class*=\"discount\"], [class*=\"Discount\"], [class*=\"savings\"]');
  const totalEl = document.querySelector('[class*=\"grand-total\"], [class*=\"GrandTotal\"], [class*=\"total-amount\"], [class*=\"TotalAmount\"], [data-testid=\"cart-total\"], [class*=\"ToPay\"]');
  const deliveryEstEl = document.querySelector('[class*=\"delivery-time\"], [class*=\"eta\"], [class*=\"minute\"]');
  const addressEl = document.querySelector('[class*=\"address\"], [class*=\"Address\"], [class*=\"location\"]');

  const subtotalText = (subtotalEl?.textContent || '').replace(/[^\\d.]/g, '');
  const deliveryFeeText = (deliveryFeeEl?.textContent || '').replace(/[^\\d.]/g, '');
  const discountText = (discountEl?.textContent || '').replace(/[^\\d.]/g, '');
  const totalText = (totalEl?.textContent || '').replace(/[^\\d.]/g, '');

  const computedSubtotal = items.reduce((sum, it) => sum + it.subtotal, 0);

  return JSON.stringify({
    items: items,
    itemCount: items.length,
    subtotal: subtotalText ? parseFloat(subtotalText) : computedSubtotal,
    deliveryFee: deliveryFeeText ? parseFloat(deliveryFeeText) : 0,
    discount: discountText ? parseFloat(discountText) : 0,
    total: totalText ? parseFloat(totalText) : computedSubtotal,
    deliveryEstimate: (deliveryEstEl?.textContent || '').trim().substring(0, 50) || null,
    deliveryAddress: (addressEl?.textContent || '').trim().substring(0, 200) || null
  });
})()"

RESULT=$(_browser_write "$CART_URL" "$EVAL_SCRIPT" "") || exit $?
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')

PARSED=$(echo "$CONTENT" | jq -c '.' 2>/dev/null) || {
  _error_json "PAGE_CHANGED" "Could not read cart contents. The service may have updated its layout."
}

echo "$PARSED" | jq -c '.'
