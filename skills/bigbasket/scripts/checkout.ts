#!/usr/bin/env bun
/**
 * BigBasket — checkout in two phases (review, then pay after the person's yes).
 * Params: { phase?: "review" | "pay", persistentSessionId? }. See _shared/_phased_checkout.ts.
 */
import { runPhasedCheckout } from "../../_shared/_phased_checkout";
import { CONFIG as config } from "./_bigbasket";

await runPhasedCheckout({ config, platform: "bigbasket", cartUrl: `${config.baseUrl}/basket` });
