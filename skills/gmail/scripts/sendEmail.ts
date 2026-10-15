import { errorJson, requireBrowserSession } from "../../_shared/_google_helpers";
import { composeScope, sendButtonSelector } from "./_composeWindow";
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

/** Sent = OUR compose closed (or Gmail's "Message sent" toast). Another compose staying open says nothing. */
function verifySentScript(nonce: string): string {
  return `(() => {
  const sent = document.querySelector('.aT [data-tooltip*="Message sent"], .bAq .aT, .vh[data-tooltip*="sent"]');
  const compose = document.querySelector(${JSON.stringify(composeScope(nonce))});
  if (!compose || compose.offsetHeight === 0 || sent) {
    return JSON.stringify({ success: true, message: 'Email sent via browser session' });
  }
  return JSON.stringify({ success: false, message: 'Compose window still open — send may have failed' });
})()`;
}

const io = browserComposeIo();

withNewCompose(io, fields, async ({ psId, nonce }) => {
  // Send OUR compose only: a selector scoped to it can never reach another window's Send.
  const content = await io.step(psId, [
    { action: "waitForSelector", selector: sendButtonSelector(nonce) },
    { action: "click", selector: sendButtonSelector(nonce) },
    { action: "wait", delay: 3000 },
  ], verifySentScript(nonce));
  // CRAFO-988: an unreadable reply is reported as unconfirmed, never as a failure.
  return parseResultJson(content) ?? { success: null, message: "Action completed, but could not confirm the result — verify in Gmail." };
})
  .then((result) => console.log(JSON.stringify(result)))
  .catch((err) => reportComposeFailure(err, "sendEmail"));
