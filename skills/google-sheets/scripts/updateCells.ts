import { requireBrowserSession, errorJson } from "../../_shared/_google_helpers";
import { resolveDriveFile } from "../../_shared/_driveFiles";
import { parseRange, gidOf, writeCells } from "../../_shared/_sheetsEdit";

async function main() {
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
  const range: string = params.range || "";
  const values: unknown[][] = params.values || [];
  if (!range || values.length === 0) errorJson("MISSING_PARAM", "range and non-empty values are required (and spreadsheetId or name)");

  requireBrowserSession();

  const { id: spreadsheetId } = await resolveDriveFile(params, "spreadsheetId");
  const { sheet, startCol, startRow } = parseRange(range);
  const gid = await gidOf(spreadsheetId, sheet);
  const written = await writeCells(spreadsheetId, gid, startCol, startRow, values);
  console.log(JSON.stringify({ spreadsheetId, updatedRange: sheet ? `${sheet}!${written}` : written, ok: true, method: "browser" }));
}

main();
