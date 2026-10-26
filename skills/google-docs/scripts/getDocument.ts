import {
  requireBrowserSession,
  crawlUrl,
} from "../../_shared/_google_helpers";
import { resolveDriveFile } from "../../_shared/_driveFiles";

const params = JSON.parse(process.env.SKILL_PARAMS || "{}");

requireBrowserSession();

(async () => {
  // By id, or by name (owner 2026-10-11, KITS): a name is looked up in Drive first.
  const { id: documentId } = await resolveDriveFile(params, "documentId");
  const content = await crawlUrl(`https://docs.google.com/document/d/${documentId}/export?format=txt`, { allowEmpty: true });
  console.log(JSON.stringify({
    source: "browser_export",
    documentId,
    content,
  }));
})();
