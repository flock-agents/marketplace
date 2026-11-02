#!/usr/bin/env node
import { main } from '../src/server.js';

// A closed stdout means the client went away; nothing left to answer.
process.stdout.on('error', () => process.exit(0));

main().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(`zepp-mcp: ${error?.stack ?? error}\n`);
    process.exit(1);
  },
);
