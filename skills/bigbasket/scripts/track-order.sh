#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
ORDER_ID=$(echo "$PARAMS" | jq -r '.orderId // ""')

_require_browser_session
_validate_param "$ORDER_ID" "orderId"
_validate_id "$ORDER_ID" "orderId"

ORDER_URL="${BASE_URL}/order/list"

EVAL_SCRIPT="(() => {
  const targetOrderId = '${ORDER_ID}';
  const orders = document.querySelectorAll('[class*=\"order-card\"], [class*=\"OrderCard\"], [class*=\"order-item\"], [class*=\"OrderItem\"], [class*=\"order-row\"], [class*=\"OrderRow\"]');

  let matched = null;

  orders.forEach(el => {
    if (matched) return;
    const orderIdEl = el.querySelector('[class*=\"order-id\"], [class*=\"OrderId\"], [class*=\"orderId\"], [class*=\"order-number\"]');
    const orderText = (orderIdEl?.textContent || el.textContent || '').trim();

    if (orderText.includes(targetOrderId)) {
      const statusEl = el.querySelector('[class*=\"status\"], [class*=\"Status\"], [class*=\"OrderStatus\"]');
      const dateEl = el.querySelector('[class*=\"date\"], [class*=\"Date\"], [class*=\"OrderDate\"], time');
      const totalEl = el.querySelector('[class*=\"total\"], [class*=\"Total\"], [class*=\"amount\"], [class*=\"Amount\"]');
      const deliveryEl = el.querySelector('[class*=\"delivery\"], [class*=\"eta\"], [class*=\"minute\"], [class*=\"DeliveryInfo\"]');

      const itemEls = el.querySelectorAll('[class*=\"item-name\"], [class*=\"ItemName\"], [class*=\"product-name\"], li');
      const items = [];
      itemEls.forEach(itemEl => {
        const name = (itemEl.textContent || '').trim().substring(0, 200);
        if (name) items.push({ name: name, quantity: 1, price: null });
      });

      const statusText = (statusEl?.textContent || '').trim();
      const statusLower = statusText.toLowerCase();
      let status = 'unknown';
      if (statusLower.includes('deliver')) status = 'delivered';
      else if (statusLower.includes('out for')) status = 'out_for_delivery';
      else if (statusLower.includes('pack') || statusLower.includes('prepar')) status = 'being_packed';
      else if (statusLower.includes('confirm')) status = 'confirmed';
      else if (statusLower.includes('cancel')) status = 'cancelled';
      else if (statusLower.includes('refund')) status = 'refunded';
      else if (statusLower.includes('placed') || statusLower.includes('received')) status = 'placed';

      const totalText = (totalEl?.textContent || '').replace(/[^\\d.]/g, '');

      matched = {
        orderId: targetOrderId,
        status: status,
        statusLabel: statusText.substring(0, 100) || status,
        placedAt: (dateEl?.textContent || dateEl?.getAttribute('datetime') || '').trim().substring(0, 50) || null,
        estimatedDelivery: (deliveryEl?.textContent || '').trim().substring(0, 50) || null,
        items: items,
        total: totalText ? parseFloat(totalText) : null,
        deliveryPartner: null,
        trackingUrl: null
      };
    }
  });

  if (!matched) {
    return JSON.stringify({ error: true, code: 'ORDER_NOT_FOUND', message: 'Order ' + targetOrderId + ' not found' });
  }

  return JSON.stringify(matched);
})()"

RESULT=$(_browser_write "$ORDER_URL" "$EVAL_SCRIPT" "") || exit $?
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')

PARSED=$(echo "$CONTENT" | jq -c '.' 2>/dev/null) || {
  _error_json "PAGE_CHANGED" "Could not read order information. The service may have updated its layout."
}

IS_ERROR=$(echo "$PARSED" | jq -r '.error // false')
if [ "$IS_ERROR" = "true" ]; then
  echo "$PARSED"
  exit 1
fi

echo "$PARSED" | jq -c '.'
