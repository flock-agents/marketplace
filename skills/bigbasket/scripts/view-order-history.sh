#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
MAX_RESULTS=$(echo "$PARAMS" | jq -r '.maxResults // 10')

_require_browser_session

if ! [[ "$MAX_RESULTS" =~ ^[0-9]+$ ]]; then MAX_RESULTS=10; fi
if [ "$MAX_RESULTS" -gt 25 ]; then MAX_RESULTS=25; fi
if [ "$MAX_RESULTS" -lt 1 ]; then MAX_RESULTS=1; fi

ORDERS_URL="${BASE_URL}/order/list"

EVAL_SCRIPT="(() => {
  const maxResults = ${MAX_RESULTS};
  const orders = [];
  const orderEls = document.querySelectorAll('[class*=\"order-card\"], [class*=\"OrderCard\"], [class*=\"order-item\"], [class*=\"OrderItem\"], [class*=\"order-row\"], [class*=\"OrderRow\"]');

  orderEls.forEach((el, i) => {
    if (i >= maxResults) return;

    const orderIdEl = el.querySelector('[class*=\"order-id\"], [class*=\"OrderId\"], [class*=\"orderId\"], [class*=\"order-number\"]');
    const statusEl = el.querySelector('[class*=\"status\"], [class*=\"Status\"], [class*=\"OrderStatus\"]');
    const dateEl = el.querySelector('[class*=\"date\"], [class*=\"Date\"], [class*=\"OrderDate\"], time');
    const totalEl = el.querySelector('[class*=\"total\"], [class*=\"Total\"], [class*=\"amount\"], [class*=\"Amount\"]');
    const itemCountEl = el.querySelector('[class*=\"item-count\"], [class*=\"ItemCount\"], [class*=\"items\"]');

    const orderIdText = (orderIdEl?.textContent || '').trim().substring(0, 50);
    if (!orderIdText && !dateEl) return;

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
    const itemCountText = (itemCountEl?.textContent || '').replace(/[^\\d]/g, '');

    orders.push({
      orderId: orderIdText || 'unknown-' + i,
      status: status,
      statusLabel: statusText.substring(0, 100) || status,
      placedAt: (dateEl?.textContent || dateEl?.getAttribute('datetime') || '').trim().substring(0, 50) || null,
      total: totalText ? parseFloat(totalText) : null,
      itemCount: itemCountText ? parseInt(itemCountText) : null
    });
  });

  return JSON.stringify({ orders, totalOrders: orderEls.length });
})()"

RESULT=$(_browser_write "$ORDERS_URL" "$EVAL_SCRIPT" "") || exit $?
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')

PARSED=$(echo "$CONTENT" | jq -c '.' 2>/dev/null) || {
  _error_json "PAGE_CHANGED" "Could not read order history. The service may have updated its layout."
}

ORDERS=$(echo "$PARSED" | jq -r '.orders // []')
TOTAL=$(echo "$PARSED" | jq -r '.totalOrders // 0')

jq -nc --argjson orders "$ORDERS" --argjson total "$TOTAL" \
  '{orders: $orders, totalOrders: $total}'
