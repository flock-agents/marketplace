#!/usr/bin/env bun
/**
 * Zepto — checkout in two phases (review, then pay after the person's yes).
 * Params: { phase?: "review" | "pay", persistentSessionId? }. See _shared/_phased_checkout.ts.
 */
import { type GroceryServiceConfig } from "../../_shared/_grocery_helpers";
import { runPhasedCheckout } from "../../_shared/_phased_checkout";

const config: GroceryServiceConfig = {
  name: "Zepto",
  baseUrl: "https://www.zeptonow.com",
  loginPattern: /zeptonow\.com\/auth|zeptonow\.com\/login/i,
};

await runPhasedCheckout({ config, platform: "zepto", cartUrl: `${config.baseUrl}/cart` });
