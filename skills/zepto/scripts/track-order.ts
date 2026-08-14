#!/usr/bin/env bun
/**
 * Zepto — track a specific order by orderId.
 * Params: orderId
 */
import {
  requireBrowserSession,
  validateParam,
  validateId,
  errorJson,
  browserWrite,
  type GroceryServiceConfig,
} from "../../_shared/_grocery_helpers";

const config: GroceryServiceConfig = {
  name: "Zepto",
  baseUrl: "https://www.zeptonow.com",
  loginPattern: /zeptonow\.com\/auth|zeptonow\.com\/login/i,
};

const PARAMS = JSON.parse(process.env.SKILL_PARAMS || "{}");
const orderId: string = PARAMS.orderId || "";

requireBrowserSession();
validateParam(orderId, "orderId");
validateId(orderId, "orderId");

const ordersUrl = `${config.baseUrl}/account/orders`;

const evalScript = `(() => {
  const targetOrderId = '${orderId}'.toUpperCase();
  const orderCards = document.querySelectorAll('[class*="order"], [class*="Order"], [data-testid="order-card"]');

  let orderData = null;

  orderCards.forEach(el => {
    if (orderData) return;
    const text = el.textContent || '';
    if (!text.toUpperCase().includes(targetOrderId)) return;

    const statusEl = el.querySelector('[class*="status"], [class*="Status"], [class*="state"]');
    const dateEl = el.querySelector('[class*="date"], [class*="Date"], [class*="time"], time');
    const totalEl = el.querySelector('[class*="total"], [class*="Total"], [class*="amount"], [class*="price"]');
    const deliveryEl = el.querySelector('[class*="delivery"], [class*="eta"], [class*="estimate"]');
    const partnerEl = el.querySelector('[class*="partner"], [class*="rider"], [class*="driver"]');

    const itemEls = el.querySelectorAll('[class*="item"], li');
    const items = [];
    itemEls.forEach(itemEl => {
      const itemName = (itemEl.querySelector('[class*="name"], span')?.textContent || '').trim().substring(0, 200);
      const itemQty = parseInt((itemEl.querySelector('[class*="qty"], [class*="quantity"]')?.textContent || '1').replace(/[^\\d]/g, '')) || 1;
      const itemPriceText = (itemEl.querySelector('[class*="price"]')?.textContent || '').replace(/[^\\d.]/g, '');
      if (itemName && itemName.length > 1) {
        items.push({
          name: itemName,
          quantity: itemQty,
          price: itemPriceText ? parseFloat(itemPriceText) : 0
        });
      }
    });

    const statusText = (statusEl?.textContent || '').trim().toLowerCase();
    let status = 'placed';
    if (statusText.includes('deliver')) status = statusText.includes('out') ? 'out_for_delivery' : 'delivered';
    else if (statusText.includes('cancel')) status = 'cancelled';
    else if (statusText.includes('refund')) status = 'refunded';
    else if (statusText.includes('pack')) status = 'being_packed';
    else if (statusText.includes('confirm')) status = 'confirmed';

    const totalText = (totalEl?.textContent || '').replace(/[^\\d.]/g, '');

    orderData = {
      orderId: targetOrderId,
      status: status,
      statusLabel: (statusEl?.textContent || '').trim().substring(0, 50),
      placedAt: (dateEl?.textContent || dateEl?.getAttribute('datetime') || '').trim().substring(0, 50) || null,
      estimatedDelivery: (deliveryEl?.textContent || '').trim().substring(0, 100) || null,
      items: items,
      total: totalText ? parseFloat(totalText) : 0,
      deliveryPartner: (partnerEl?.textContent || '').trim().substring(0, 50) || null,
      trackingUrl: null
    };
  });

  if (!orderData) {
    return JSON.stringify({ error: true, code: 'ORDER_NOT_FOUND', message: 'Order ' + targetOrderId + ' not found' });
  }

  return JSON.stringify(orderData);
})()`;

const result = await browserWrite(config, ordersUrl, evalScript);
const content: string = result.content || "{}";

let parsed: any;
try {
  parsed = JSON.parse(content);
} catch {
  errorJson("PAGE_CHANGED", "Could not read order details. The service may have updated its layout.");
}

if (parsed.error) {
  console.log(JSON.stringify(parsed));
  process.exit(1);
}

console.log(JSON.stringify(parsed));
