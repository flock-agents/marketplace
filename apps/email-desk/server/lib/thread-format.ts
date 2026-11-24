// The shared thread-body text format.
//
// The harvest runner (renderSegments / segmentsFromRow) and thread-body-store
// (renderThreadMessages, the drafting donation) BOTH write and re-split this
// format, and they MUST agree byte-for-byte: a parked body is round-tripped
// (park → recover → split) through exactly this separator. Each file used to
// declare its own copy "to avoid an import" — identical values that would
// silently drift, corrupting every reused body, the moment one changed. One
// source of truth here removes that drift.

// The separator between two messages of one rendered/stored thread. `From: <who>`
// opens each message; `segmentsFromRow` splits a parked body back apart on this
// string so the harvest's self-poisoning guard runs PER MESSAGE.
export const THREAD_BODY_SEPARATOR = "\n\n---\n\n";

// Upper bound on one rendered block / stored body. A block is one extraction
// call, so text past this cap can never reach the extractor; storing it would
// only cost disk. Matches routes/memory-extract.ts's MAX_ITEM_CHARS.
export const MAX_BODY_CHARS = 20_000;
