#!/usr/bin/env bun
/**
 * BigBasket — the cart's items and its full total with every fee, read only from the cart page. Params: (none)
 */
import { viewCart } from "./_shop_run";
import { BIGBASKET } from "./_bigbasket";

await viewCart(BIGBASKET);
