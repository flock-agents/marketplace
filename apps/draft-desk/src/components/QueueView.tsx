import { useCallback, useEffect, useRef, useState } from "react";
import type { ReplyDraft } from "../../shared/types";
import { api } from "../lib/api";
import { DraftRow } from "./DraftRow";
import { Filters, type FilterState } from "./Filters";

// How often to poll while the agent is fetching more drafts, and a hard safety cap so the UI
// never spins forever if the request never flips to `fulfilled`.
const POLL_MS = 4000;
const MAX_POLLS = 30; // ~2 min safety net

type FetchState = "idle" | "checking" | "no_new";

const CHECKING_NOTE = "Your agent's checking for new messages…";
const ALREADY_NOTE = "Your agent's already on it.";

export function QueueView({
  onOpen,
  onError,
}: {
  onOpen: (id: string) => void;
  onError: (msg: string) => void;
}) {
  const [filters, setFilters] = useState<FilterState>({ status: "", source: "" });
  const [drafts, setDrafts] = useState<ReplyDraft[] | null>(null);
  const [awaiting, setAwaiting] = useState<number | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>("idle");
  const [checkingNote, setCheckingNote] = useState(CHECKING_NOTE);

  // The pending request we're currently watching (null when nothing is in flight) and the
  // draft count captured when the fetch began, so we can tell when NEW drafts arrive.
  const activeRequestRef = useRef<string | null>(null);
  const baselineRef = useRef(0);

  // Fetch the list + awaiting count for the current filters. `blank` shows the loading
  // state (used on filter changes); polling refreshes silently to avoid flicker.
  const reload = useCallback(
    async (blank: boolean) => {
      if (blank) setDrafts(null);
      try {
        const [list, count] = await Promise.all([api.listDrafts(filters), api.countAwaiting()]);
        setDrafts(list);
        setAwaiting(count.count);
        return list.length;
      } catch (e) {
        if (blank) setDrafts([]);
        onError((e as Error).message);
        return null;
      }
    },
    [filters, onError],
  );

  useEffect(() => {
    reload(true);
  }, [reload]);

  // On mount, adopt any fetch already in flight (e.g. after a page reload) so the button
  // stays disabled and the note stays visible until the agent fulfills the request.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const pending = await api.pendingRequests();
        if (!active || pending.length === 0) return;
        activeRequestRef.current = pending[0].id;
        baselineRef.current = 0; // unknown prior count — any current drafts count as "already there"
        setCheckingNote(CHECKING_NOTE);
        setFetchState("checking");
      } catch {
        // Non-fatal: the button simply starts in its idle state.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Poll while the agent is checking. Stops when new drafts appear (list grows past the
  // baseline) or when the watched request flips to `fulfilled` (→ "no new messages").
  useEffect(() => {
    if (fetchState !== "checking") return;
    let polls = 0;
    let active = true;

    const finish = (next: FetchState) => {
      activeRequestRef.current = null;
      setFetchState(next);
    };

    const timer = setInterval(async () => {
      if (!active) return;
      polls += 1;

      const len = await reload(false);
      if (!active) return;
      if (len !== null && len > baselineRef.current) {
        finish("idle"); // new drafts are now visible in the list
        return;
      }

      const requestId = activeRequestRef.current;
      if (requestId) {
        try {
          const req = await api.getRequest(requestId);
          if (active && req.status === "fulfilled") {
            finish("no_new");
            return;
          }
        } catch {
          // Ignore a transient poll error; the safety cap below still applies.
        }
      }

      if (active && polls >= MAX_POLLS) finish("no_new");
    }, POLL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [fetchState, reload]);

  const getMore = async () => {
    baselineRef.current = drafts?.length ?? 0;
    setCheckingNote(CHECKING_NOTE);
    setFetchState("checking");
    try {
      const res = await api.requestMore();
      activeRequestRef.current = res.request.id;
      if (res.reason === "already_pending") setCheckingNote(ALREADY_NOTE);
    } catch (e) {
      activeRequestRef.current = null;
      setFetchState("idle");
      onError((e as Error).message);
    }
  };

  return (
    <div>
      <div className="app-header">
        <div className="app-title">
          <h1>Draft Desk</h1>
          <div className="subtitle">Your agent drafts · you approve · nothing sends without you</div>
        </div>
        <div className="header-actions">
          {awaiting !== null && (
            <span className="awaiting-badge" title="Drafts awaiting your review">
              {awaiting} awaiting you
            </span>
          )}
          <button
            className="flock-btn flock-btn-primary"
            onClick={getMore}
            disabled={fetchState === "checking"}
          >
            {fetchState === "checking" ? "Your agent's checking…" : "Get more drafts"}
          </button>
        </div>
      </div>

      {fetchState === "checking" && <div className="fetch-note checking">{checkingNote}</div>}
      {fetchState === "no_new" && (
        <div className="fetch-note">
          No new messages right now.
          <button className="link-btn" onClick={() => setFetchState("idle")}>
            Dismiss
          </button>
        </div>
      )}

      <Filters value={filters} onChange={setFilters} />

      {drafts === null ? (
        <div className="loading">Loading drafts…</div>
      ) : drafts.length === 0 ? (
        <div className="empty">No drafts here yet.</div>
      ) : (
        <div className="queue-list">
          {drafts.map((d) => (
            <DraftRow key={d.id} draft={d} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}
