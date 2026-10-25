import { requireBrowserSession, errorJson } from "../../_shared/_google_helpers";
import { resolveDriveFile } from "../../_shared/_driveFiles";
import { parseRange, gidOf, readCells } from "../../_shared/_sheetsEdit";

async function main() {
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
  const range: string = params.range || "";
  if (!range) errorJson("MISSING_PARAM", "range is required (and spreadsheetId or name)");

  requireBrowserSession();

  // By id, or by name (looked up in Drive), as getSpreadsheet.
  const { id: spreadsheetId } = await resolveDriveFile(params, "spreadsheetId");
  const { sheet, a1 } = parseRange(range);
  const gid = await gidOf(spreadsheetId, sheet);
  const values = await readCells(spreadsheetId, gid, a1);
  console.log(JSON.stringify({ spreadsheetId, range, values, rows: values.length, source: "browser_export" }));
}

main();
