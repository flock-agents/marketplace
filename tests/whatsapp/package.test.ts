// WhatsApp skill: the package as Flock installs it. Manifest, scripts, catalog entry, checksums,
// and the words the person reads.
//
// Run: bun test tests/whatsapp.
import { describe, expect, it } from "bun:test";
import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const root = join(import.meta.dir, "../..");
const skillDir = join(root, "skills/whatsapp");
const manifest = JSON.parse(readFileSync(join(skillDir, "flock.skill.json"), "utf8"));
const instructions = readFileSync(join(skillDir, "instructions.md"), "utf8");
const catalog = JSON.parse(readFileSync(join(root, "catalog.json"), "utf8"));
const FUNCTIONS = ["list-chats", "read-chat", "search", "send-message"];

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesIn(path) : [relative(skillDir, path)];
  });
}

describe("the manifest", () => {
  it("is the whatsapp sign-in on web.whatsapp.com", () => {
    expect(manifest.slug).toBe("whatsapp");
    expect(manifest.tier).toBe("installable");
    expect(manifest.requires).toEqual([expect.objectContaining({ type: "browser_session", service: "whatsapp", loginUrl: "https://web.whatsapp.com/" })]);
    expect(manifest.security.networkEndpoints.map((e: any) => e.hostname)).toEqual(["web.whatsapp.com"]);
    expect(manifest.security.trustLevel).toBe("third-party");
  });

  it("reads are read, the send is irreversible, and every function has its own script", () => {
    expect(manifest.security.allowedFunctions).toEqual(FUNCTIONS);
    expect(manifest.security.functionEffects).toEqual({ "list-chats": "read", "read-chat": "read", search: "read", "send-message": "irreversible" });
    for (const fn of FUNCTIONS) {
      expect(existsSync(join(skillDir, "scripts", `${fn}.ts`))).toBe(true);
      expect(manifest.functions[fn].timeoutMs).toBeGreaterThan(60_000);
      expect(instructions).toContain(`### ${fn}`);
    }
  });

  it("instructions name the whatsapp sign-in, and the changelog has this version", () => {
    expect(instructions).toMatch(/^---\n[\s\S]*auth:\n {2}type: browser_session\n {2}session_name: whatsapp\n[\s\S]*tier: installable\n---\n/);
    expect(readFileSync(join(skillDir, "CHANGELOG.md"), "utf8")).toContain(`## ${manifest.version}`);
  });
});

describe("the catalog entry", () => {
  it("points at this package and the tag to create", () => {
    const entry = catalog.items.find((i: any) => i.slug === "whatsapp");
    expect(entry).toMatchObject({ type: "connector", path: "skills/whatsapp", latestVersion: manifest.version, latestTag: `whatsapp-v${manifest.version}`, minFlockVersion: manifest.minFlockVersion });
  });
});

describe("the checksums", () => {
  it("cover every file as it is now", () => {
    const sums = JSON.parse(readFileSync(join(skillDir, ".flock-checksums.json"), "utf8"));
    expect(sums.sourceVersion).toBe(manifest.version);
    expect(sums.sourceTag).toBe(`whatsapp-v${manifest.version}`);
    const files = filesIn(skillDir).filter((f) => f !== ".flock-checksums.json").sort();
    expect(Object.keys(sums.files).sort()).toEqual(files);
    for (const f of files) expect(sums.files[f]).toBe(createHash("sha256").update(readFileSync(join(skillDir, f))).digest("hex"));
  });
});

describe("the sign-in steps", () => {
  const signIn = instructions.slice(instructions.indexOf("## Sign-in"), instructions.indexOf("## Talking to the person"));

  it("send the number with sign_in, never typed with act, and never ask the person for a code", () => {
    expect(signIn).toContain("Never type their number with `act`");
    expect(signIn).toContain("never ask the person for a code and never use `sign_in` with `code`");
    expect(signIn).toContain("`open` `https://web.whatsapp.com` with `purpose` `connector`");
  });

  it("post the link code only in the person's own chat, as the one exception to the private-browser rule", () => {
    expect(signIn).toContain("The one exception to the private-browser skill");
    expect(signIn).toContain("For this WhatsApp link code only");
    expect(signIn).toContain("Only in their own chat.");
    expect(signIn).toContain("Never in a group or shared chat");
  });

  it("call it a link code wherever the person or the waiting card sees it", () => {
    const seen = [...signIn.matchAll(/```action-card\n([\s\S]*?)```/g)].map((m) => m[1]).concat([...signIn.matchAll(/"question": "([^"]+)"/g)].map((m) => m[1]));
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const words of seen) expect(words).not.toMatch(/verification code|\botp\b|security code|passcode/i);
    expect(JSON.parse(seen[0]).title).toContain("link code");
    expect(seen.some((q) => q.includes("link code"))).toBe(true);
  });

  it("record the link on a new window with kind handoff, and the QR code through hand_to_owner", () => {
    expect(signIn).toMatch(/`close` that window, `open` `https:\/\/web\.whatsapp\.com` again[\s\S]*`signed_in` on this NEW window with kind `handoff`/);
    expect(signIn).toContain("`hand_to_owner`");
    expect(signIn).toContain("At most 3 link codes");
    expect(signIn).toContain("use `sign_in` there with its `windowId` and `url` `https://web.whatsapp.com`");
    expect(signIn).toContain('click "Log in with QR code" with `act`');
    expect(signIn).not.toContain("codeValidMinutes\": ");
  });
});

describe("what the person reads", () => {
  const sendCard = instructions.match(/```action-card\n([\s\S]*?)```/)?.[1] ?? "";

  it("the code card is valid, plain and complete", () => {
    const card = JSON.parse(sendCard);
    expect(card).toMatchObject({ type: "info", title: expect.stringContaining("code") });
    for (const words of ["Enter code to link new device", "Confirm", "Android", "iPhone", "Linked devices", "Link with phone number instead", "ask me for a new one", "QR code? Just say so"]) expect(card.body).toContain(words);
    expect(card.body).not.toMatch(/minute|expires? in/i);
  });

  it("has no em dashes and no system words", () => {
    const ownerText = [manifest.description, manifest.requires[0].description, sendCard, ...[...instructions.matchAll(/"(?:question|reason)"?:? "([^"]+)"/g)].map((m) => m[1])];
    for (const t of ownerText) {
      expect(t).not.toContain("—");
      expect(t).not.toMatch(/\b(session|connector|browser profile|token)\b/i);
    }
    expect(instructions).not.toContain("—");
  });
});
