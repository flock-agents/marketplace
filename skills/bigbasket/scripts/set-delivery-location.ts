#!/usr/bin/env bun
/**
 * BigBasket — select the saved delivery address that matches the given one, before searching. Params: address
 */
import { setDeliveryLocation } from "./_shop_run";
import { BIGBASKET } from "./_bigbasket";

await setDeliveryLocation(BIGBASKET);
