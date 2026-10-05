// listDraftThreads.ts — every thread that has a draft in Gmail right now, from the paged
// #drafts list, WITHOUT opening any conversation (2026-09-24). The reply-card check asks this
// once per mailbox instead of opening each card's thread, which marks it read.
//
// `complete: false` means the walk did not reach the last page (see _draftList.ts); the caller
// must treat the list as "could not look".
//
// Input  (SKILL_PARAMS): {}
// Output (stdout JSON):  { threadIds: string[], complete: boolean, pages: number, reason: string }

import { errorJson, requireBrowserSession } from "../../_shared/_google_helpers";
import { readDraftList, browserDraftListIo } from "./_draftList";

if (process.env.SKILL_PARAMS !== undefined) {
  runScript();
}

function runScript(): void {
  requireBrowserSession();
  (async () => {
    const read = await readDraftList(browserDraftListIo());
    const threadIds = [...new Set(read.rows.map((r) => r.threadId))];
    console.log(JSON.stringify({ threadIds, complete: read.complete, pages: read.pages, reason: read.reason }));
  })().catch((err: any) => {
    errorJson("BROWSER_ERROR", `Could not read the drafts list: ${err?.message || err}`);
  });
}
