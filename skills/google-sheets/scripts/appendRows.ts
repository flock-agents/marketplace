import { requireBrowserSession, errorJson } from "../../_shared/_google_helpers";
import { resolveDriveFile } from "../../_shared/_driveFiles";
import { parseRange, gidOf, readCells, writeCells } from "../../_shared/_sheetsEdit";

async function main() {
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
  const range: string = params.range || "A1";
  const values: unknown[][] = params.values || [];
  if (values.length === 0) errorJson("MISSING_PARAM", "non-empty values are required (and spreadsheetId or name)");

  requireBrowserSession();

  const { id: spreadsheetId } = await resolveDriveFile(params, "spreadsheetId");
  // Below the sheet's last row that has anything in it, starting at the range's first column.
  const { sheet, startCol } = parseRange(range);
  const gid = await gidOf(spreadsheetId, sheet);
  const rows = await readCells(spreadsheetId, gid);
  let used = rows.length;
  while (used > 0 && rows[used - 1].every((c) => c.trim() === "")) used--;
  const written = await writeCells(spreadsheetId, gid, startCol, used + 1, values);
  console.log(JSON.stringify({ spreadsheetId, appendedRange: sheet ? `${sheet}!${written}` : written, ok: true, method: "browser" }));
}

main();
