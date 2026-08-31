// The ONLY place fetch appears in the frontend. Relative paths only ("./api/...") so
// requests resolve under /a/draft-desk/ via the injected <base> tag.
import type {
  CommentInput,
  CommentResponse,
  DraftDetail,
  DraftRequest,
  DraftSource,
  DraftStatus,
  PatchDraftInput,
  ReplyDraft,
  RequestMoreResponse,
} from "../../shared/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`./api/${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface DraftFilters {
  status?: DraftStatus | "";
  source?: DraftSource | "";
}

export const api = {
  listDrafts(filters: DraftFilters): Promise<ReplyDraft[]> {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.source) params.set("source", filters.source);
    const qs = params.toString();
    return request<ReplyDraft[]>(`drafts${qs ? `?${qs}` : ""}`);
  },

  getDraft(id: string): Promise<DraftDetail> {
    return request<DraftDetail>(`drafts/${id}`);
  },

  patchDraft(id: string, changes: PatchDraftInput): Promise<ReplyDraft> {
    return request<ReplyDraft>(`drafts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    });
  },

  comment(id: string, input: CommentInput): Promise<CommentResponse> {
    return request<CommentResponse>(`drafts/${id}/comment`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  // Restore a discarded draft back to needs_review so it re-enters the queue.
  restore(id: string): Promise<ReplyDraft> {
    return request<ReplyDraft>(`drafts/${id}/restore`, { method: "POST" });
  },

  countAwaiting(): Promise<{ count: number }> {
    return request<{ count: number }>(`drafts/count`);
  },

  requestMore(): Promise<RequestMoreResponse> {
    return request<RequestMoreResponse>(`drafts/request-more`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  getRequest(id: string): Promise<DraftRequest> {
    return request<DraftRequest>(`requests/${id}`);
  },

  pendingRequests(): Promise<DraftRequest[]> {
    return request<DraftRequest[]>(`requests?status=pending`);
  },
};
