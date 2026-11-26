/**
 * A dummy WhatsApp Web, for the Flock runs in this folder. Nothing here reaches WhatsApp.
 *
 * Logged out, it serves web.whatsapp.com's own saved screens (../fixtures/logged-out-*.html): "Scan
 * to log in" with a QR whose data-ref refreshes, "Log in with phone number", the phone screen with
 * the "🇮🇳 India" button and the "Type your phone number to log in to WhatsApp" box holding "+91 ",
 * Next, then an "Enter code on phone" screen with an 8-character code. Signed in, it serves the
 * stand-in app (../fixtures/app.html) the skill's selectors were written for.
 *
 * As WhatsApp keeps its link in the browser's own storage, the page keeps a device id in
 * localStorage: a window opened again in the same profile finds the link. The test plays the phone
 * through `phone` (link the pending code, scan the QR, log out) and reads what was sent.
 *
 * `handle` answers a Request (served by Playwright routes in the Flock runs, or `serve()` for a look).
 */
import { readFileSync } from "fs";
import { join } from "path";

const FIXTURES = join(import.meta.dir, "..", "fixtures");
const bodyOf = (file: string) => {
  const html = readFileSync(join(FIXTURES, file), "utf8");
  return html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));
};
const QR_BODY = bodyOf("logged-out-qr.html");
const PHONE_BODY = bodyOf("logged-out-phone.html");
const APP_HTML = readFileSync(join(FIXTURES, "app.html"), "utf8");
const USE_HERE_BODY = bodyOf("use-here.html").replace(/<script>[\s\S]*<\/script>/, "");

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTVWXYZ0123456789";
const newCode = () => Array.from({ length: 8 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");

export interface Sent { chat: string; text: string }

export interface DummyOptions {
  /** The number box holds "+91 " in its value, as the saved page's box does (value="+91 "), and
   *  keeps it while typing. False: the box holds only what is typed, "+91" shown beside it. */
  boxKeepsCountryCode?: boolean;
  /** Enter in the number box goes on as Next does (the box sits alone in its <form>, Next outside it). */
  enterSubmits?: boolean;
}

export function whatsappDummy(initial: DummyOptions = {}) {
  const options: Required<DummyOptions> = { boxKeepsCountryCode: true, enterSubmits: true, ...initial };
  /** device id → linked. */
  const linked = new Set<string>();
  /** The code each device asked for, and the number it was for. */
  const pending = new Map<string, { code: string; phone: string }>();
  const numbersAsked: string[] = [];
  const sent: Sent[] = [];
  /** Documents the page fetched to download them, by file name. */
  const docFetches: string[] = [];
  /** Every device that loaded the page. */
  const seen = new Set<string>();
  let useHereNext = 0;
  let loads = 0;

  const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
  const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

  /** The page itself: it reads its device id and asks which screen to show. */
  const LOADER = `<!DOCTYPE html><html><head><title>WhatsApp</title><meta name="wa-dummy" content="1"></head><body><script>
    (async () => {
      let device = localStorage.getItem("wa-device");
      if (!device) { device = "d" + Math.random().toString(36).slice(2); localStorage.setItem("wa-device", device); }
      const page = await (await fetch("/__dummy/page?device=" + device)).text();
      document.open(); document.write(page); document.close();
    })();
  </script></body></html>`;

  const marker = `<meta name="wa-dummy" content="1">`;

  /** The logged-out screens, wired as WhatsApp's are. */
  const loggedOut = (device: string) => `<!DOCTYPE html><html><head><title>WhatsApp</title>${marker}</head><body><div id="screen">${QR_BODY}</div><script>
    (() => {
      const device = ${JSON.stringify(device)};
      const screen = document.getElementById("screen");
      const QR = ${JSON.stringify(QR_BODY)}, PHONE = ${JSON.stringify(PHONE_BODY)};
      const refreshQr = () => { const c = document.querySelector("canvas"); if (c) c.parentElement.setAttribute("data-ref", "2@" + Math.random().toString(36).slice(2)); };
      const onQr = () => {
        screen.innerHTML = QR; refreshQr();
        document.querySelector('[data-testid="link_device_qr_phone_number_link"]').addEventListener("click", onPhone);
      };
      const onPhone = () => {
        screen.innerHTML = PHONE;
        const box = document.querySelector('[data-testid="phone-number-input"]');
        const keepsCode = ${options.boxKeepsCountryCode};
        const options = { enterSubmits: ${options.enterSubmits} };
        const national = () => { const d = box.value.replace(/\\D/g, ""); return keepsCode && box.value.trim().startsWith("+") && d.startsWith("91") ? d.slice(2) : d; };
        box.value = keepsCode ? "+91 " : "";
        box.addEventListener("input", () => {
          const n = national().slice(0, 10);
          const spaced = n.slice(0, 5) + (n.length > 5 ? " " + n.slice(5) : "");
          box.value = keepsCode ? "+91 " + spaced : spaced;
        });
        document.querySelector('[data-testid="link_device_phone_number_qr_link"]').addEventListener("click", onQr);
        const next = Array.from(document.querySelectorAll("button")).find((b) => b.innerText.trim() === "Next");
        const form = box.closest("form");
        form.addEventListener("submit", (e) => { e.preventDefault(); if (options.enterSubmits) next.click(); });
        next.addEventListener("click", async () => {
          const number = national();
          if (number.length !== 10) return;
          const r = await (await fetch("/__dummy/request-code", { method: "POST", body: JSON.stringify({ device, phone: "+91" + number }) })).json();
          screen.innerHTML = '<div data-testid="link-device-phone-number-code-screen"><div><div>Enter code on phone</div></div>'
            + '<div>Linking WhatsApp account +91 ' + number.slice(0, 5) + ' ' + number.slice(5) + ' (edit)</div>'
            + '<div aria-details="link-device-phone-number-code-screen-instructions" data-link-code="' + r.code + '">'
            + r.code.split("").map((ch, i) => (i === 4 ? '<span>-</span>' : '') + '<span>' + ch + '</span>').join("") + '</div>'
            + '<ol><li>Open WhatsApp on your phone</li><li>Tap Menu or Settings and select Linked devices</li><li>Tap Link a device</li><li>Tap Link with phone number instead and enter this code on your phone</li></ol>'
            + '<div role="button" tabindex="0" data-testid="link_device_phone_number_code_screen_qr_link">Log in with QR code</div></div>';
          document.querySelector('[data-testid="link_device_phone_number_code_screen_qr_link"]').addEventListener("click", onQr);
        });
      };
      onQr();
      setInterval(refreshQr, 2000);
      setInterval(async () => { if ((await (await fetch("/__dummy/state?device=" + device)).json()).linked) location.reload(); }, 500);
    })();
  </script></body></html>`;

  const signedIn = () => APP_HTML.replace("<head>", `<head>${marker}`);
  const useHere = () => `<!DOCTYPE html><html><head><title>WhatsApp</title>${marker}</head><body>${USE_HERE_BODY}<script>
    document.getElementById("use").addEventListener("click", () => location.reload());
  </script></body></html>`;

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const device = url.searchParams.get("device") ?? "";
    if (url.pathname === "/") return html(LOADER);
    if (url.pathname === "/__dummy/page") {
      loads++;
      seen.add(device);
      if (!linked.has(device)) return html(loggedOut(device));
      if (useHereNext > 0) { useHereNext--; return html(useHere()); }
      return html(signedIn());
    }
    if (url.pathname === "/__dummy/state") return json({ linked: linked.has(device) });
    if (url.pathname === "/__dummy/request-code" && req.method === "POST") {
      const body = await req.json() as { device: string; phone: string };
      const code = newCode();
      pending.set(body.device, { code, phone: body.phone });
      numbersAsked.push(body.phone);
      return json({ code });
    }
    if (url.pathname === "/__dummy/doc") {
      docFetches.push(url.searchParams.get("name") ?? "");
      return json({ ok: true });
    }
    if (url.pathname === "/__dummy/send" && req.method === "POST") {
      sent.push(await req.json() as Sent);
      return json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  }

  /** What the person's phone does. */
  const phone = {
    /** Types `code` on the phone: links the device that asked for it. False when no device did. */
    enterCode(code: string): boolean {
      const want = code.replace(/[^A-Z0-9]/gi, "").toUpperCase();
      for (const [device, p] of pending) if (p.code === want) { linked.add(device); pending.delete(device); return true; }
      return false;
    },
    /** Scans the QR: links every device showing it now (the test names which). */
    scanQr(device: string): void { linked.add(device); pending.delete(device); },
    /** Logs every linked device out, as removing it under Linked devices does. */
    logOutAll(): void { linked.clear(); },
    /** Links every device that loaded the page, without any code: for the runs that only need a linked WhatsApp. */
    linkEverySeen(): void { for (const d of seen) linked.add(d); },
  };

  return {
    handle, phone, sent, docFetches, numbersAsked, options,
    pendingCodes: () => [...pending.values()].map((p) => p.code),
    linkedDevices: () => [...linked],
    showUseHereNext(times = 1) { useHereNext = times; },
    loads: () => loads,
  };
}

export type WhatsAppDummy = ReturnType<typeof whatsappDummy>;

/** Serves `dummy` on 127.0.0.1 for a look by hand: `bun tests/whatsapp/dummy/site.ts`. */
if (import.meta.main) {
  const dummy = whatsappDummy();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: dummy.handle });
  console.log(`dummy WhatsApp Web on http://127.0.0.1:${server.port}/`);
}
