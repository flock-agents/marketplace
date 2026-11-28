// WhatsApp connector: the package as Flock installs it. Manifest, server, bundle, catalog entry,
// checksums, and the words the person reads.
//
// Run: bun test tests/whatsapp.
import { describe, expect, it } from "bun:test";
import { createHash } from "crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join, relative } from "path";
import { LINK_CODE_STEPS, LINK_QR_STEPS, QR_MESSAGE, linkCodeMessage } from "../../skills/whatsapp/server/_guide";
import { bunAtLeast } from "../../skills/whatsapp/server/_socket";

const root = join(import.meta.dir, "../..");
const skillDir = join(root, "skills/whatsapp");
const manifest = JSON.parse(readFileSync(join(skillDir, "flock.skill.json"), "utf8"));
const instructions = readFileSync(join(skillDir, "instructions.md"), "utf8");
const catalog = JSON.parse(readFileSync(join(root, "catalog.json"), "utf8"));
const TOOLS = ["link", "link-status", "list-chats", "read-chat", "search", "send-message", "unlink"];

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesIn(path) : [relative(skillDir, path)];
  });
}

describe("the manifest", () => {
  it("is a local MCP server Flock starts from the package, through its egress, with no form to fill", () => {
    expect(manifest).toMatchObject({ slug: "whatsapp", version: "2.1.1", tier: "installable" });
    expect(manifest.requires).toHaveLength(1);
    const [req] = manifest.requires;
    expect(req.type).toBe("mcp_server");
    expect(req.mcp).toMatchObject({ transport: "stdio", command: "bun", args: ["{packageDir}/server/server.ts"], egress: true, envVars: [], credentialsRequired: false });
    expect(existsSync(join(skillDir, "server/server.ts"))).toBe(true);
    for (const a of req.mcp.args) expect(a).not.toMatch(/[;|&`$()><]/);
  });

  it("names every tool, reads as reads, the send irreversible", () => {
    expect(manifest.security.allowedFunctions).toEqual(TOOLS);
    expect(manifest.security.functionEffects).toEqual({ link: "write", "link-status": "read", "list-chats": "read", "read-chat": "read", search: "read", "send-message": "irreversible", unlink: "write" });
    for (const t of TOOLS) expect(instructions).toContain(`### ${t}`);
    expect(manifest.security.networkEndpoints.map((e: any) => e.hostname)).toEqual(["web.whatsapp.com", "mmg.whatsapp.net"]);
    expect(manifest.security.trustLevel).toBe("third-party");
  });

  it("instructions have no browser sign-in, and the changelog has this version", () => {
    expect(instructions).toMatch(/^---\nname: WhatsApp\n[\s\S]*tier: installable\n---\n/);
    expect(instructions).not.toMatch(/browser_session|sign_in|hand_to_owner|signed_in/);
    expect(readFileSync(join(skillDir, "CHANGELOG.md"), "utf8")).toContain(`## ${manifest.version}`);
  });
});

describe("the package's files", () => {
  it("ships the server, its parts and the one bundle, and no browser script", () => {
    const scripts = readdirSync(join(skillDir, "server")).sort();
    expect(scripts).toEqual(["_guide.ts", "_limits.ts", "_mcp.ts", "_messages.ts", "_socket.ts", "_store.ts", "_tools.ts", "_whatsapp.ts", "lib", "server.ts"]);
    expect(readdirSync(join(skillDir, "server/lib"))).toEqual(["baileys.bundle.js"]);
    const size = statSync(join(skillDir, "server/lib/baileys.bundle.js")).size;
    expect(size).toBeGreaterThan(1_000_000);
    expect(size).toBeLessThan(10 * 1024 * 1024);
  });

  it("the bundle carries no path of the machine it was built on", () => {
    const bundle = readFileSync(join(skillDir, "server/lib/baileys.bundle.js"), "utf8");
    expect(bundle).not.toMatch(/"\/(Users|home|private|tmp|var)\//);
  });

  const bundleTool = join(root, "tools/whatsapp-bundle");
  // Bun's bundler output differs between Bun versions; the shipped bundle is built with Bun 1.3.
  it.skipIf(!existsSync(join(bundleTool, "node_modules")) || !bunAtLeast(Bun.version))("the bundle is exactly what tools/whatsapp-bundle builds from the lockfile", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "wa-bundle-")), "baileys.bundle.js");
    try {
      const build = Bun.spawn(["bun", "build.ts", out], { cwd: bundleTool, stdout: "ignore", stderr: "inherit" });
      expect(await build.exited).toBe(0);
      const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
      expect(sha(out)).toBe(sha(join(skillDir, "server/lib/baileys.bundle.js")));
    } finally { rmSync(join(out, ".."), { recursive: true, force: true }); }
  }, 60_000);

  it("the bundle is built from the pinned versions", () => {
    const pkg = JSON.parse(readFileSync(join(root, "tools/whatsapp-bundle/package.json"), "utf8"));
    expect(pkg.dependencies["@whiskeysockets/baileys"]).toBe("7.0.0-rc14");
    expect(Object.values(pkg.dependencies).every((v) => /^\d/.test(String(v)))).toBe(true);
    expect(existsSync(join(root, "tools/whatsapp-bundle/bun.lock"))).toBe(true);
  });
});

describe("the catalog entry", () => {
  it("points at this package and its rc tag", () => {
    const entry = catalog.items.find((i: any) => i.slug === "whatsapp");
    expect(entry).toMatchObject({ type: "connector", path: "skills/whatsapp", latestVersion: "2.1.1", latestTag: "whatsapp-v2.1.1-rc1", minFlockVersion: manifest.minFlockVersion });
  });
});

describe("the checksums", () => {
  it("cover every file as it is now", () => {
    const sums = JSON.parse(readFileSync(join(skillDir, ".flock-checksums.json"), "utf8"));
    expect(sums.sourceVersion).toBe(manifest.version);
    expect(sums.sourceTag).toBe("whatsapp-v2.1.1-rc1");
    const files = filesIn(skillDir).filter((f) => f !== ".flock-checksums.json").sort();
    expect(Object.keys(sums.files).sort()).toEqual(files);
    for (const f of files) expect(sums.files[f]).toBe(createHash("sha256").update(readFileSync(join(skillDir, f))).digest("hex"));
  });
});

describe("the linking steps", () => {
  const linking = instructions.slice(instructions.indexOf("## Linking"), instructions.indexOf("## Talking to the person"));

  it("give the link code first, a QR code only on request, and never ask the person for a code", () => {
    expect(linking).toContain("Link code first; a QR code only when they ask for one");
    expect(linking).toContain("Never ask the person for a code");
    expect(linking).toContain('`link` with `{"qr": true}`');
    expect(linking).toContain("cannot scan a picture on that same phone");
    expect(linking).toContain("At most 3 link codes");
  });

  it("post the link code only in the person's own chat, as the one exception to the private-browser rule", () => {
    expect(linking).toContain("The one exception to the private-browser skill");
    expect(linking).toContain("For this WhatsApp link code only");
    expect(linking).toContain("Only in their own chat.");
    expect(linking).toContain("Never in a group or shared chat");
  });

  it("call it a link code wherever the person or the waiting card sees it", () => {
    const seen = [...linking.matchAll(/```action-card\n([\s\S]*?)```/g)].map((m) => m[1]).concat([...linking.matchAll(/"question": "([^"]+)"/g)].map((m) => m[1]));
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const words of seen) expect(words).not.toMatch(/verification code|\botp\b|security code|passcode/i);
    expect(JSON.parse(seen[0]).title).toContain("link code");
    expect(linking).not.toContain('codeValidMinutes": ');
  });
});

describe("what the person reads", () => {
  const cardOf = () => JSON.parse(instructions.match(/```action-card\n([\s\S]*?)```/)?.[1] ?? "{}");

  it("the code card gives WhatsApp's notification and both phones' steps, and no expiry", () => {
    const card = cardOf();
    expect(card).toMatchObject({ type: "info", title: expect.stringContaining("link code") });
    for (const words of ['"Enter code to link new device" notification', "Android: ⋮ (top right) > Linked devices > Link a device > Link with phone number instead", "iPhone: Settings > Linked devices > Link device > Link with phone number instead", "Unlock, then type the code", "ask me for a new one", "QR code? Just say so"]) {
      expect(card.body).toContain(words);
    }
    expect(card.body).not.toMatch(/minute|expires? in/i);
  });

  it("the words link's answer gives the person: short, a \"link code\", no em dashes, no system words", () => {
    for (const words of [linkCodeMessage("K7QD-2M9X"), QR_MESSAGE]) {
      expect(words).not.toContain("—");
      expect(words).not.toMatch(/verification code|\botp\b|security code|passcode|\b(session|connector|socket|proxy|token|server|pairing)\b/i);
      expect(words.length).toBeLessThan(500);
    }
    expect(linkCodeMessage("K7QD-2M9X")).toContain("Your WhatsApp link code: K7QD-2M9X");
    expect(linkCodeMessage("K7QD-2M9X")).not.toMatch(/minute|expires? in/i);
    for (const steps of [LINK_CODE_STEPS, LINK_QR_STEPS]) {
      expect(steps).not.toContain("—");
      expect(steps).toMatch(/own chat/);
    }
    expect(LINK_CODE_STEPS).toMatch(/never in a group or shared chat/);
  });

  it("has no em dashes and no system words", () => {
    const card = cardOf();
    const ownerText = [manifest.description, manifest.requires[0].description, manifest.requires[0].mcp.setupInstructions, card.title, card.body,
      ...[...instructions.matchAll(/"question": "([^"]+)"/g)].map((m) => m[1])];
    for (const t of ownerText) {
      expect(t).not.toContain("—");
      expect(t).not.toMatch(/\b(session|connector|socket|proxy|token|server)\b/i);
    }
    expect(instructions).not.toContain("—");
  });
});
