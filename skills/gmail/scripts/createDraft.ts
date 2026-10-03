import { errorJson, requireBrowserSession } from "../../_shared/_google_helpers";
import { saveAndCloseComposeScript } from "./_composeWindow";
import {
  browserComposeIo,
  composeFieldsFromParams,
  withNewCompose,
  reportComposeFailure,
  parseResultJson,
} from "./_composeFlow";

const fields = composeFieldsFromParams(JSON.parse(process.env.SKILL_PARAMS || "{}"));

requireBrowserSession();

if (!fields.to || !fields.subject) {
  errorJson("MISSING_PARAM", "to and subject are required");
}

const io = browserComposeIo();

withNewCompose(io, fields, async ({ psId, nonce }) => {
  // Save & close OUR compose -- only a control named as one, never a guess
  // (see _composeSave.ts and _composeWindow.ts).
  const content = await io.step(psId, [
    { action: "evaluate", script: saveAndCloseComposeScript(nonce) },
    { action: "wait", delay: 1500 },
  ], `(() => JSON.stringify({ success: true, message: 'Draft created via browser session' }))()`);
  // CRAFO-988: an unreadable reply is reported as unconfirmed, never as a failure.
  return parseResultJson(content) ?? { success: null, message: "Action completed, but could not confirm the result — verify in Gmail." };
})
  .then((result) => console.log(JSON.stringify(result)))
  .catch((err) => reportComposeFailure(err, "createDraft"));
