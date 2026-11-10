#!/usr/bin/env bun
/**
 * Zepto — list the saved delivery addresses and the one in use. Params: (none)
 */
import { listAddresses } from "./_shop_run";
import { ZEPTO } from "./_zepto";

await listAddresses(ZEPTO);
