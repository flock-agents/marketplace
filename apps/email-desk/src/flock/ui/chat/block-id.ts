// The id a block's reply-capable or makeApp node is given when the agent wrote none (or a bad one): a slug of its
// title or question, then a hash of the whole block as the agent wrote it, so a later block in the chat cannot take
// the same id and look answered. The hash is of JSON.stringify(JSON.parse(raw)), which the frame, the server and the
// chat page all compute alike: the chat page (frontend/src/lib/chat/block-id.ts, a mirror pinned by a test) accepts a
// generated id only when it carries its own block's hash. Pure, no imports.

/** FNV-1a of `s`, as 4 base-36 characters. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return ((h >>> 0) % 36 ** 4).toString(36).padStart(4, "0");
}

/** The block's hash: of the parsed block, so spacing in the agent's text does not change it. */
export const blockHash = (spec: unknown): string => shortHash(JSON.stringify(spec) ?? "");

/** Lowercase letters and digits joined by -, at most 40 characters ("" when nothing is left). */
export const idSlug = (s: string): string =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");

/** `name`'s slug (else `fallback`'s), then the block's hash. */
export const generatedId = (name: string | undefined, fallback: string, hash: string): string =>
  `${(name && idSlug(name)) || idSlug(fallback) || "block"}-${hash}`;

/** An id generatedId made for the block whose hash is `hash` (a second one in the block ends in _). */
export const isGeneratedId = (id: string, hash: string): boolean =>
  new RegExp(`^[a-z0-9]+(?:-[a-z0-9]+)*-${hash}_*$`).test(id);
