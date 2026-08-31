import { useCallback, useEffect, useState } from "react";
import { QueueView } from "./components/QueueView";
import { DraftDetail } from "./components/DraftDetail";
import { startVersionWatch } from "./lib/version";

// Minimal hash router: "#/" = queue, "#/draft/:id" = detail. baseTag stays on;
// hash routing avoids server-side route handling entirely.
function parseHash(): { view: "queue" } | { view: "detail"; id: string } {
  const hash = window.location.hash.replace(/^#/, "");
  const match = hash.match(/^\/draft\/(.+)$/);
  if (match) return { view: "detail", id: match[1] };
  return { view: "queue" };
}

interface Toast {
  msg: string;
  error: boolean;
}

export default function App() {
  const [route, setRoute] = useState(parseHash());
  const [toast, setToast] = useState<Toast | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Auto-update: when a newer build is deployed, briefly show a banner, then reload to adopt it.
  useEffect(() => {
    return startVersionWatch(() => {
      setUpdating(true);
      window.setTimeout(() => window.location.reload(), 1500);
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const showToast = useCallback((msg: string) => setToast({ msg, error: false }), []);
  const showError = useCallback((msg: string) => setToast({ msg, error: true }), []);

  const openDraft = (id: string) => {
    window.location.hash = `/draft/${id}`;
  };
  const goQueue = () => {
    window.location.hash = "/";
  };

  return (
    <div className="flock-container">
      {updating && <div className="update-banner">New version — updating…</div>}

      {route.view === "queue" ? (
        <QueueView onOpen={openDraft} onError={showError} />
      ) : (
        <DraftDetail
          id={route.id}
          onBack={goQueue}
          onToast={showToast}
          onError={showError}
        />
      )}

      {toast && <div className={`toast ${toast.error ? "error" : ""}`}>{toast.msg}</div>}
    </div>
  );
}
