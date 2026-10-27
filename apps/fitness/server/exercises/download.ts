// Fetches an exercise's moving picture for the library: http(s) only, a GIF, WebP or MP4, at most MAX_BYTES, within TIMEOUT_MS.
// Anything else is refused with a reason the coach can act on (find another picture, or add the exercise without one).

export const MAX_BYTES = 10 * 1024 * 1024;
export const TIMEOUT_MS = 20_000;
/** The picture types the library shows, and the extension each is kept under. */
export const MEDIA_TYPES: Record<string, string> = { "image/gif": "gif", "image/webp": "webp", "video/mp4": "mp4" };

export type Fetch = (url: string, init: { signal: AbortSignal; redirect: "follow" }) => Promise<Response>;
export type Download = { ok: true; bytes: Uint8Array; ext: string; type: string } | { ok: false; error: string };

export async function downloadMedia(url: string, fetchImpl: Fetch = fetch, timeoutMs = TIMEOUT_MS): Promise<Download> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, error: "gifUrl is not a valid URL" }; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false, error: "gifUrl must be http(s)" };
  let res: Response;
  try { res = await fetchImpl(parsed.toString(), { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" }); }
  catch (e) { return { ok: false, error: `could not download the picture: ${(e as Error).message}` }; }
  if (!res.ok) return { ok: false, error: `could not download the picture: HTTP ${res.status}` };
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = MEDIA_TYPES[type];
  if (!ext) return { ok: false, error: `the picture must be a GIF, WebP or MP4 (got ${type || "no content type"}): link the file itself, not its page` };
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return { ok: false, error: "the picture is larger than 10 MB" };
  const reader = res.body?.getReader();
  if (!reader) return { ok: false, error: "the picture is empty" };
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read().catch((e) => { throw new Error(`could not download the picture: ${(e as Error).message}`); });
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel().catch(() => {}); return { ok: false, error: "the picture is larger than 10 MB" }; }
    chunks.push(value);
  }
  if (!size) return { ok: false, error: "the picture is empty" };
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
  return { ok: true, bytes, ext, type };
}
