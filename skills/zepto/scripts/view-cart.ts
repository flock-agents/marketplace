#!/usr/bin/env bun
/**
 * Zepto — the cart's items and its full total with every fee, read only from the cart page. Params: (none)
 */
import { viewCart } from "./_shop_run";
import { ZEPTO } from "./_zepto";

await viewCart(ZEPTO);
