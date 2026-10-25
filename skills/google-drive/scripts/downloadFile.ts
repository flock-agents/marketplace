import { requireBrowserSession } from "../../_shared/_google_helpers";
import { resolveDriveFile, downloadDriveFile } from "../../_shared/_driveFiles";

async function main() {
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");

  requireBrowserSession();

  // By id, or by name (owner 2026-10-11, KITS). The file lands in the agent's own downloads
  // folder, where its shell and Read tool can open it.
  const { id: fileId, kind, name } = await resolveDriveFile(params);
  const saved = await downloadDriveFile(fileId, kind);
  console.log(JSON.stringify({
    source: "browser_download",
    fileId,
    ...(name ? { name } : {}),
    ...(kind ? { kind } : {}),
    ...saved,
    note: "Saved as a local file. For a spreadsheet's values as text, google-sheets getSpreadsheet with this id returns CSV.",
  }));
}

main();
