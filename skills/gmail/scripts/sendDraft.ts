import {
  errorJson,
  requireBrowserSession,
  validateId,
  persistentCreate,
  persistentInteract,
} from "../../_shared/_google_helpers";

const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
const draftId: string = params.draftId || "";

requireBrowserSession();

if (!draftId) {
  errorJson("MISSING_PARAM", "draftId is required (use the draft's thread/message ID from Gmail)");
}
validateId(draftId, "draftId");

const openAndSend = `(function(){
  var compose = document.querySelector("div[aria-label=\\"Message Body\\"][contenteditable=\\"true\\"]") ||
                document.querySelector(".Am.Al.editable") ||
                document.querySelector("[role=\\"textbox\\"][aria-label*=\\"Message\\"]");
  if (!compose) return {ok:false, message:"Draft compose area not found. The draft may not have opened correctly."};
  var sendBtn = document.querySelector("[aria-label*=\\"Send\\"]:not([aria-label*=\\"Schedule\\"])") ||
                document.querySelector(".T-I.J-J5-Ji.aoO.v7.T-I-atl.L3");
  if (!sendBtn) return {ok:false, message:"Send button not found in draft compose window"};
  sendBtn.click();
  return {ok:true, message:"Draft sent successfully"};
})()`;

(async () => {
  const sessionResult = await persistentCreate(
    `https://mail.google.com/mail/u/0/#drafts/${draftId}`,
  );
  const psId: string = sessionResult?.persistentSessionId || "";

  if (!psId) {
    errorJson("SESSION_ERROR", "Failed to create persistent session for draft");
  }

  const sendActions = [
    { action: "wait", delay: 3000 },
    { action: "evaluate", script: openAndSend },
    { action: "wait", delay: 2000 },
  ];

  const sendResult = await persistentInteract(psId, sendActions, true);
  const content = sendResult?.content || "{}";
  let parsed: any;
  try { parsed = typeof content === "string" ? JSON.parse(content) : content; }
  catch { parsed = { success: null, message: "Action completed, but could not confirm the result — verify in Gmail." }; } // CRAFO-988
  const sendOk = parsed?.ok ?? false;

  if (sendOk) {
    console.log(JSON.stringify({ ok: true, draftId, message: "Draft sent successfully" }));
  } else {
    const sendMsg = parsed?.message || "unknown error";
    errorJson("BROWSER_ERROR", `Failed to send draft: ${sendMsg}`);
  }
})();
