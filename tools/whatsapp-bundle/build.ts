// Builds skills/whatsapp/server/lib/baileys.bundle.js from entry.ts and the locked dependencies. Bun
// writes the absolute folder of two CommonJS modules into the bundle (pino's unused worker paths), so
// this folder is replaced by "." there: the bundle is then the same wherever it is built.
import { join } from "path";

const OUTFILE = join(import.meta.dir, "../../skills/whatsapp/server/lib/baileys.bundle.js");
const EXTERNAL = ["sharp", "jimp", "link-preview-js", "audio-decode"];

const result = await Bun.build({ entrypoints: [join(import.meta.dir, "entry.ts")], target: "bun", minify: true, external: EXTERNAL });
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const code = (await result.outputs[0].text()).replaceAll(`"${import.meta.dir}/`, `"./`);
await Bun.write(process.argv[2] ?? OUTFILE, code);
console.log(`baileys.bundle.js: ${Buffer.byteLength(code)} bytes, sha256 ${new Bun.CryptoHasher("sha256").update(code).digest("hex")}`);
