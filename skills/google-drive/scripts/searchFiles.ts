import { requireBrowserSession, errorJson } from "../../_shared/_google_helpers";
import { searchDrive } from "../../_shared/_driveFiles";
import { driveSearchTerms } from "../../_shared/_driveParse";

async function main() {
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
  const query: string = params.query || "";
  const maxResults = Math.max(1, Math.min(Number(params.maxResults) || 25, 100));

  if (!query) errorJson("MISSING_PARAM", "query is required");
  if (!driveSearchTerms(query).length) errorJson("INVALID_PARAM", "query names no words to search for. Pass plain words, e.g. \"Grant Spend Monitor\".");

  requireBrowserSession();

  // Each result with its id (owner 2026-10-11, KITS): page text alone could not be opened.
  const files = (await searchDrive(query)).slice(0, maxResults);
  const searched = driveSearchTerms(query);
  console.log(JSON.stringify({
    source: "drive_search", query, ...(searched.length !== 1 || searched[0] !== query.trim() ? { searched } : {}), files,
    ...(files.length ? { note: "Open one with getFile or downloadFile ({fileId}), google-sheets getSpreadsheet ({spreadsheetId}) or google-docs getDocument ({documentId})." } : { note: "No files matched. Try fewer or different words." }),
  }));
}

main();
