#!/usr/bin/env bun
/**
 * Zepto — select the saved delivery address that matches the given one, before searching. Params: address
 */
import { setDeliveryLocation } from "./_shop_run";
import { ZEPTO } from "./_zepto";

await setDeliveryLocation(ZEPTO);
