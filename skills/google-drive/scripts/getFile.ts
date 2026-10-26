import { requireBrowserSession, crawlUrl } from "../../_shared/_google_helpers";
import { resolveDriveFile } from "../../_shared/_driveFiles";
import { driveTextUrl, driveFileUrl } from "../../_shared/_driveParse";

async function main() {
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");

  requireBrowserSession();

  // By id, or by name (owner 2026-10-11, KITS): a name is looked up in Drive first.
  const { id: fileId, kind, name } = await resolveDriveFile(params);

  let content: string;
  try {
    // Its text by kind: a Doc as text, a sheet as CSV, slides as text; unknown → a Doc's export.
    content = await crawlUrl(driveTextUrl(fileId, kind || "Google Docs"));
  } catch {
    // Fall back to the viewer page.
    content = await crawlUrl(`https://drive.google.com/file/d/${fileId}/view`);
  }

  console.log(JSON.stringify({
    source: "browser_session",
    fileId,
    ...(name ? { name } : {}),
    ...(kind ? { kind } : {}),
    url: driveFileUrl(fileId, kind),
    content,
  }));
}

main();
