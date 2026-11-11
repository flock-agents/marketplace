#!/usr/bin/env bun
/**
 * Blinkit — select the saved delivery address that matches the given one, before searching. Params: address
 */
import { setDeliveryLocation } from "./_shop_run";
import { BLINKIT_SITE } from "./_blinkit";

await setDeliveryLocation(BLINKIT_SITE);
