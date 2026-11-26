// The grocery website skills' base URL: the real shop, unless an isolated e2e Flock sets
// FLOCK_CONNECTOR_BASE_URL to a stand-in shop. Each case loads the skill's site file in its own Bun
// process, as a script run does, so the env var is read the way the scripts read it.
//
// Run: FLOCK_APP_DIR=<flock>/flock-app bun test ./tests/grocery (see _flock.ts).
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { appDir, hasShared, sayWhySkipped } from "./_flock";

sayWhySkipped();
type Shop = typeof import("../../skills/bigbasket/scripts/_shop");
const { baseUrlFrom, sitePattern } = (hasShared ? await import("../../skills/bigbasket/scripts/_shop") : {}) as Shop;
const skills = join(import.meta.dir, "../../skills");

const SHOPS = {
  bigbasket: {
    file: join(skills, "bigbasket/scripts/_bigbasket.ts"),
    read: "{ baseUrl: m.CONFIG.baseUrl, homeUrl: m.BIGBASKET.homeUrl, cartUrl: m.BIGBASKET.cartUrl, login: m.CONFIG.loginPattern.source, flags: m.CONFIG.loginPattern.flags, siteConfigShared: m.BIGBASKET.config === m.CONFIG }",
    real: "https://www.bigbasket.com",
    fake: "http://bigbasket.localhost:35883",
    loginPaths: ["signin", "login"],
  },
  "zomato-blinkit": {
    file: join(skills, "zomato-blinkit/scripts/_blinkit.ts"),
    read: "{ baseUrl: m.BLINKIT.baseUrl, homeUrl: m.HOME_URL, cartUrl: m.BLINKIT_SITE.cartUrl, login: m.BLINKIT.loginPattern.source, flags: m.BLINKIT.loginPattern.flags, payment: m.PAYMENT_PAGE.source, order: m.ORDER_PAGE.source }",
    real: "https://blinkit.com",
    fake: "http://blinkit.localhost:35884",
    loginPaths: ["login", "auth"],
  },
} as const;
type Slug = keyof typeof SHOPS;

/** The skill's site values with FLOCK_CONNECTOR_BASE_URL as given (unset when undefined). */
function siteWith(slug: Slug, base: string | undefined): Record<string, any> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), FLOCK_APP_DIR: appDir };
  delete env.FLOCK_CONNECTOR_BASE_URL;
  if (base !== undefined) env.FLOCK_CONNECTOR_BASE_URL = base;
  const code = `const m = await import(${JSON.stringify(SHOPS[slug].file)}); console.log(JSON.stringify(${SHOPS[slug].read}));`;
  const run = Bun.spawnSync([process.execPath, "--preload", join(import.meta.dir, "_flock.ts"), "-e", code], { env, cwd: import.meta.dir });
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return JSON.parse(run.stdout.toString().trim().split("\n").pop()!);
}

const patternOf = (site: Record<string, any>, key = "login") => new RegExp(site[key], site.flags ?? "i");

describe.skipIf(!hasShared)("baseUrlFrom", () => {
  const real = "https://www.bigbasket.com";

  it("is the real site when the override is unset, empty or not a bare http(s) origin", () => {
    for (const bad of [undefined, "", "  ", "not a url", "ftp://bigbasket.localhost:35883", "file:///tmp/x", "javascript:alert(1)",
      "http://bigbasket.localhost:35883/shop", "http://bigbasket.localhost:35883/?q=1", "http://bigbasket.localhost:35883/#x",
      "http://user:pw@bigbasket.localhost:35883"]) expect(baseUrlFrom(bad, real)).toBe(real);
  });

  it("is the override's origin, without a trailing slash", () => {
    expect(baseUrlFrom("http://bigbasket.localhost:35883", real)).toBe("http://bigbasket.localhost:35883");
    expect(baseUrlFrom("http://bigbasket.localhost:35883/", real)).toBe("http://bigbasket.localhost:35883");
    expect(baseUrlFrom("https://shop.test", real)).toBe("https://shop.test");
  });

  it("sitePattern escapes the host and keeps its port", () => {
    const p = sitePattern("http://bigbasket.localhost:35883", "signin|login");
    expect(p.test("http://bigbasket.localhost:35883/login")).toBe(true);
    expect(p.test("http://bigbasketXlocalhost:35883/login")).toBe(false);
    expect(p.test("http://bigbasket.localhost:35884/login")).toBe(false);
  });
});

for (const slug of Object.keys(SHOPS) as Slug[]) {
  const shop = SHOPS[slug];

  describe.skipIf(!hasShared)(`${slug}: the base URL`, () => {
    it("is the real site when FLOCK_CONNECTOR_BASE_URL is unset or invalid", () => {
      for (const base of [undefined, "", "not a url", `${shop.fake}/path`, "ftp://example.test"]) {
        const site = siteWith(slug, base);
        expect(site.baseUrl).toBe(shop.real);
        expect(site.homeUrl).toBe(`${shop.real}/`);
      }
    });

    it("is the stand-in shop when FLOCK_CONNECTOR_BASE_URL is set", () => {
      for (const base of [shop.fake, `${shop.fake}/`]) {
        const site = siteWith(slug, base);
        expect(site.baseUrl).toBe(shop.fake);
        expect(site.homeUrl).toBe(`${shop.fake}/`);
        expect(site.cartUrl.startsWith(`${shop.fake}/`)).toBe(true);
      }
    });

    it("loginPattern matches the real login pages, and the stand-in's when it is set", () => {
      const real = patternOf(siteWith(slug, undefined));
      const fake = patternOf(siteWith(slug, shop.fake));
      for (const path of shop.loginPaths) {
        expect(real.test(`${shop.real}/${path}`)).toBe(true);
        expect(real.test(`${shop.real.replace("://www.", "://")}/${path.toUpperCase()}`)).toBe(true);
        expect(fake.test(`${shop.fake}/${path}`)).toBe(true);
        expect(real.test(`${shop.fake}/${path}`)).toBe(false);
        expect(fake.test(`${shop.real}/${path}`)).toBe(false);
      }
      expect(real.test(`${shop.real}/`)).toBe(false);
      expect(fake.test(`${shop.fake}/`)).toBe(false);
    });
  });
}

describe.skipIf(!hasShared)("zomato-blinkit: the payment and order pages", () => {
  it("are matched on the real site and on the stand-in", () => {
    for (const [base, site] of [[SHOPS["zomato-blinkit"].real, siteWith("zomato-blinkit", undefined)], [SHOPS["zomato-blinkit"].fake, siteWith("zomato-blinkit", SHOPS["zomato-blinkit"].fake)]] as const) {
      expect(patternOf(site, "payment").test(`${base}/checkout`)).toBe(true);
      expect(patternOf(site, "order").test(`${base}/order/ORD123`)).toBe(true);
      expect(patternOf(site, "order").test(`${base}/orders`)).toBe(false);
    }
  });
});

describe("the shop host", () => {
  it("is written only in each skill's site file, so FLOCK_CONNECTOR_BASE_URL reaches every script", () => {
    const sites: Record<string, string> = { bigbasket: "_bigbasket.ts", "zomato-blinkit": "_blinkit.ts" };
    for (const [skill, siteFile] of Object.entries(sites)) {
      const dir = join(skills, skill, "scripts");
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== siteFile)) {
        const code = readFileSync(join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/[^\n]*/gm, "");
        expect(code).not.toMatch(/bigbasket\\?\.com|blinkit\\?\.com/);
      }
    }
  });
});
