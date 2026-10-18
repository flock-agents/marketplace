#!/usr/bin/env bun
/**
 * BigBasket — checkout in two phases (review, then pay after the person's yes).
 * Params: { phase?: "review" | "pay", persistentSessionId? }. See _shared/_phased_checkout.ts.
 */
import { type GroceryServiceConfig } from "../../_shared/_grocery_helpers";
import { runPhasedCheckout } from "../../_shared/_phased_checkout";

const config: GroceryServiceConfig = {
  name: "BigBasket",
  baseUrl: "https://www.bigbasket.com",
  loginPattern: /bigbasket\.com\/signin|bigbasket\.com\/login/i,
};

await runPhasedCheckout({ config, platform: "bigbasket", cartUrl: `${config.baseUrl}/basket` });
