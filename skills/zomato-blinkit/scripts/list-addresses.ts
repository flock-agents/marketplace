#!/usr/bin/env bun
/**
 * Blinkit — list the saved delivery addresses and the one in use. Params: (none)
 */
import { listAddresses } from "./_shop_run";
import { BLINKIT_SITE } from "./_blinkit";

await listAddresses(BLINKIT_SITE);
