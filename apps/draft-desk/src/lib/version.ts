// Client-side auto-update. The build bakes __APP_VERSION__ into this bundle; the server reports
// the CURRENTLY deployed build's version at GET /api/version. When they diverge, a new build has
// shipped and the running SPA is stale — we reload to adopt it. This matters on mobile, where a
// long-lived open SPA never re-fetches index.html on its own and users can't hard-refresh.

declare const __APP_VERSION__: string;

// The version this running client was built with. `dev` when not defined (e.g. non-vite context).
export const LOADED_VERSION: string =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

const POLL_MS = 50_000;
const RELOAD_GUARD_KEY = "draft-desk:reloaded-for";

async function fetchServerVersion(): Promise<string | null> {
  try {
    const res = await fetch("./api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

// Reload at most ONCE per target version. If we already reloaded for this exact server version and
// still see a mismatch (e.g. an intermediary cache hasn't caught up), don't loop.
function shouldReloadFor(serverVersion: string): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_GUARD_KEY) === serverVersion) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, serverVersion);
  } catch {
    // sessionStorage unavailable — allow a single reload attempt rather than blocking updates.
  }
  return true;
}

// Poll GET /api/version on an interval and whenever the tab regains focus/visibility. Invokes
// onUpdate(serverVersion) at most once, only for a real reloadable change — never on a failed
// fetch and never when already current, so it can't cause a reload loop. Returns a cleanup fn.
export function startVersionWatch(onUpdate: (serverVersion: string) => void): () => void {
  let stopped = false;
  let notified = false;

  const check = async () => {
    if (stopped || notified) return;
    const server = await fetchServerVersion();
    if (!server || server === LOADED_VERSION) return;
    if (!shouldReloadFor(server)) return;
    notified = true;
    onUpdate(server);
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") check();
  };

  const interval = window.setInterval(check, POLL_MS);
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", onVisible);
  check();

  return () => {
    stopped = true;
    window.clearInterval(interval);
    window.removeEventListener("focus", check);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
