import { errorJson, requireBrowserSession } from "../../_shared/_google_helpers";
import { resolveDriveFile } from "../../_shared/_driveFiles";
import { typeInDoc } from "../../_shared/_docsEdit";

const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
const text: string = params.text || "";
if (!text) errorJson("MISSING_PARAM", "text is required (and documentId or name)");

requireBrowserSession();

(async () => {
  // By id, or by name (looked up in Drive), as getDocument.
  const { id: documentId } = await resolveDriveFile(params, "documentId");
  const { autocorrected } = await typeInDoc(documentId, "start", text);
  console.log(JSON.stringify({ documentId, ok: true, method: "browser", ...(autocorrected ? { autocorrected: true } : {}) }));
})();
