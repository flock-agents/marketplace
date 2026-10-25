import { requireBrowserSession, crawlUrl } from "../../_shared/_google_helpers";
import { resolveDriveFile } from "../../_shared/_driveFiles";

async function main() {
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");

  requireBrowserSession();

  // By id, or by name (owner 2026-10-11, KITS): a name is looked up in Drive first.
  const { id: spreadsheetId } = await resolveDriveFile(params, "spreadsheetId");

  const content = await crawlUrl(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`, { allowEmpty: true });
  console.log(JSON.stringify({
    source: "browser_export",
    spreadsheetId,
    note: "Spreadsheet exported as CSV via browser session.",
    content,
  }));
}

main();
