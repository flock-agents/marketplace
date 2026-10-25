import { requireBrowserSession, validateId, crawlUrl } from "../../_shared/_google_helpers";
import { searchDrive } from "../../_shared/_driveFiles";

async function main() {
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
  const query: string = params.query || "";
  const folderId: string = params.folderId || "";

  if (folderId) validateId(folderId, "folderId");

  requireBrowserSession();

  let url = "https://drive.google.com/drive/my-drive";
  if (folderId) {
    url = `https://drive.google.com/drive/folders/${folderId}`;
  }
  // A query is a search: the same plain-word search as searchFiles, with each file's id (owner
  // 2026-10-11, KITS: API syntax typed into the web search box matched nothing).
  if (query) {
    const files = await searchDrive(query);
    console.log(JSON.stringify({ source: "drive_search", query, files }));
    return;
  }

  const content = await crawlUrl(url);
  console.log(JSON.stringify({ source: "drive_list", content }));
}

main();
