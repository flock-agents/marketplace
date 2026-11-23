#!/usr/bin/env bun
/**
 * BigBasket — list the saved delivery addresses and the one in use. Params: (none)
 */
import { listAddresses } from "./_shop_run";
import { BIGBASKET } from "./_bigbasket";

await listAddresses(BIGBASKET);
