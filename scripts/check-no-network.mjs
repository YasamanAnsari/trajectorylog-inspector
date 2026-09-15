#!/usr/bin/env node
/**
 * CI guard: fails if the production bundle contains network APIs that could
 * transmit user data. Run after `npm run build`.
 * Note: `fetch(` alone would false-positive on unrelated identifiers, so we
 * match calls/constructions of the actual browser network APIs.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIST = new URL("../dist/assets", import.meta.url).pathname;
const FORBIDDEN = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bnavigator\.sendBeacon\b/,
  /new\s+WebSocket\b/,
  /new\s+EventSource\b/,
  /\bimportScripts\s*\(/,
];

let failed = false;
for (const file of readdirSync(DIST)) {
  if (!file.endsWith(".js")) continue;
  const source = readFileSync(join(DIST, file), "utf8");
  for (const pattern of FORBIDDEN) {
    const match = source.match(pattern);
    if (match) {
      console.error(`FAIL: ${file} contains forbidden network API: ${match[0]}`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}
console.log("OK: production bundle contains no network APIs.");
