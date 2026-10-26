import { errorJson, requireBrowserSession } from "../../_shared/_google_helpers";
import { resolveDriveFile } from "../../_shared/_driveFiles";
import { DOCS_KEYS, editDoc, readBackUntil } from "../../_shared/_docsEdit";

const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
const find: string = params.find || "";
const replace: string = params.replace || "";
if (!find) errorJson("MISSING_PARAM", "find is required (and documentId or name)");

requireBrowserSession();

const CLICK_REPLACE_ALL = `(function(){
  var dlg = document.querySelector(".docs-findandreplace-content") ||
            document.querySelector("[role=\\"dialog\\"]");
  if (!dlg) return {ok:false, message:"Find and Replace dialog not found"};
  var btns = dlg.querySelectorAll("button");
  for (var i = 0; i < btns.length; i++) {
    if (/replace.all/i.test(btns[i].textContent)) {
      btns[i].click();
      return {ok:true, message:"Replace all executed via browser"};
    }
  }
  var ariaBtn = dlg.querySelector("[aria-label*=\\"Replace all\\"], [aria-label*=\\"replace all\\"]");
  if (ariaBtn) { ariaBtn.click(); return {ok:true, message:"Replace all executed via browser"}; }
  return {ok:false, message:"Replace All button not found in dialog"};
})()`;

const loose = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

(async () => {
  const { id: documentId } = await resolveDriveFile(params, "documentId");
  await editDoc(documentId, [
    { action: "press", key: DOCS_KEYS.findReplace },
    { action: "waitForSelector", selector: '.docs-findandreplace-content, [role="dialog"]', delay: 5000 },
    { action: "wait", delay: 500 },
    { action: "click", selector: '.docs-findandreplace-content input[type="text"]:first-of-type, [role="dialog"] input:first-of-type' },
    { action: "press", key: DOCS_KEYS.selectAll },
    { action: "type", text: find },
    { action: "press", key: "Tab" },
    { action: "press", key: DOCS_KEYS.selectAll },
    { action: "type", text: replace },
    { action: "wait", delay: 300 },
    { action: "evaluate", script: CLICK_REPLACE_ALL },
    { action: "wait", delay: 1000 },
    { action: "press", key: "Escape" },
  ]);
  // Docs replaces regardless of case: done when `find` is gone (or only survives inside `replace`).
  const gone = (t: string) => !t.split(loose(replace)).join("").includes(loose(find));
  const after = await readBackUntil(documentId, gone);
  if (after === null) errorJson("EDIT_NOT_CONFIRMED", `Ran Replace all, but the document still contains "${find}". Read it with getDocument before trying again.`);
  console.log(JSON.stringify({ documentId, ok: true, method: "browser" }));
})();
