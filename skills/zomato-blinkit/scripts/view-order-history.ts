#!/usr/bin/env bun
/**
 * Blinkit — view recent order history.
 * Params: maxResults?
 */
import {
  requireBrowserSession,
  errorJson,
  browserWrite,
  type GroceryServiceConfig,
} from "../../_shared/_grocery_helpers";

const config: GroceryServiceConfig = {
  name: "Blinkit",
  baseUrl: "https://blinkit.com",
  loginPattern: /blinkit\.com\/login|blinkit\.com\/auth/i,
};

const PARAMS = JSON.parse(process.env.SKILL_PARAMS || "{}");
let maxResults: number = parseInt(PARAMS.maxResults, 10) || 10;

requireBrowserSession();

if (isNaN(maxResults) || maxResults < 1) maxResults = 1;
if (maxResults > 25) maxResults = 25;

const ordersUrl = `${config.baseUrl}/orders`;

const evalScript = `(() => {
  const maxResults = ${maxResults};
  const orders = [];
  const orderCards = document.querySelectorAll('[class*="order"], [class*="Order"], [data-testid="order-card"]');

  orderCards.forEach((el, i) => {
    if (i >= maxResults) return;

    const orderIdEl = el.querySelector('[class*="order-id"], [class*="OrderId"], [class*="orderId"]');
    const statusEl = el.querySelector('[class*="status"], [class*="Status"], [class*="state"]');
    const dateEl = el.querySelector('[class*="date"], [class*="Date"], [class*="time"], time');
    const totalEl = el.querySelector('[class*="total"], [class*="Total"], [class*="amount"], [class*="price"]');
    const itemCountEl = el.querySelector('[class*="item-count"], [class*="ItemCount"], [class*="items"]');

    const itemEls = el.querySelectorAll('[class*="item-name"], [class*="ItemName"], li [class*="name"]');
    const itemNames = [];
    itemEls.forEach(itemEl => {
      const name = (itemEl.textContent || '').trim().substring(0, 100);
      if (name && name.length > 1) itemNames.push(name);
    });

    const orderId = (orderIdEl?.textContent || '').trim().replace(/[^\\w-]/g, '').substring(0, 50);
    const statusText = (statusEl?.textContent || '').trim().toLowerCase();
    let status = 'placed';
    if (statusText.includes('deliver') && !statusText.includes('out')) status = 'delivered';
    else if (statusText.includes('out') && statusText.includes('deliver')) status = 'out_for_delivery';
    else if (statusText.includes('cancel')) status = 'cancelled';
    else if (statusText.includes('refund')) status = 'refunded';
    else if (statusText.includes('pack')) status = 'being_packed';
    else if (statusText.includes('confirm')) status = 'confirmed';

    const totalText = (totalEl?.textContent || '').replace(/[^\\d.]/g, '');
    const date = (dateEl?.textContent || dateEl?.getAttribute('datetime') || '').trim().substring(0, 50);

    if (!orderId && !date && itemNames.length === 0) return;

    orders.push({
      orderId: orderId || 'unknown-' + i,
      status: status,
      statusLabel: (statusEl?.textContent || '').trim().substring(0, 50),
      date: date || null,
      total: totalText ? parseFloat(totalText) : 0,
      itemCount: parseInt((itemCountEl?.textContent || '0').replace(/[^\\d]/g, '')) || itemNames.length,
      itemSummary: itemNames.slice(0, 5)
    });
  });

  return JSON.stringify({ orders: orders, totalOrders: orderCards.length });
})()`;

const result = await browserWrite(config, ordersUrl, evalScript);
const content: string = result.content || "{}";

let parsed: any;
try {
  parsed = JSON.parse(content);
} catch {
  errorJson("PAGE_CHANGED", "Could not read order history. The service may have updated its layout.");
}

console.log(JSON.stringify(parsed));
