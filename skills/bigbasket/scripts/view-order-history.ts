#!/usr/bin/env bun
/**
 * View order history on BigBasket.
 * Params: maxResults?
 */
import {
  getParam,
  errorJson,
  requireBrowserSession,
  browserWrite,
  type GroceryServiceConfig,
} from "../../_shared/_grocery_helpers";

const config: GroceryServiceConfig = {
  name: "BigBasket",
  baseUrl: "https://www.bigbasket.com",
  loginPattern: /bigbasket\.com\/signin|bigbasket\.com\/login/i,
};

let maxResults = parseInt(getParam("maxResults") || "10", 10);

requireBrowserSession();

if (isNaN(maxResults) || maxResults < 1) maxResults = 1;
if (maxResults > 25) maxResults = 25;

const ordersUrl = `${config.baseUrl}/order/list`;

const evalScript = `(() => {
  const maxResults = ${maxResults};
  const orders = [];
  const orderEls = document.querySelectorAll('[class*="order-card"], [class*="OrderCard"], [class*="order-item"], [class*="OrderItem"], [class*="order-row"], [class*="OrderRow"]');

  orderEls.forEach((el, i) => {
    if (i >= maxResults) return;

    const orderIdEl = el.querySelector('[class*="order-id"], [class*="OrderId"], [class*="orderId"], [class*="order-number"]');
    const statusEl = el.querySelector('[class*="status"], [class*="Status"], [class*="OrderStatus"]');
    const dateEl = el.querySelector('[class*="date"], [class*="Date"], [class*="OrderDate"], time');
    const totalEl = el.querySelector('[class*="total"], [class*="Total"], [class*="amount"], [class*="Amount"]');
    const itemCountEl = el.querySelector('[class*="item-count"], [class*="ItemCount"], [class*="items"]');

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
})()`;

const result = await browserWrite(config, ordersUrl, evalScript, undefined);
const content = (result as any)?.content || "{}";

let parsed: any;
try {
  parsed = JSON.parse(content);
} catch {
  errorJson("PAGE_CHANGED", "Could not read order history. The service may have updated its layout.");
}

const orders = parsed.orders || [];
const total = parsed.totalOrders || 0;

console.log(JSON.stringify({ orders, totalOrders: total }));
