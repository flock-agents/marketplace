/**
 * WhatsApp: the words the agent passes on while linking, carried in `link`'s answer. Flock replaces a
 * connected MCP connector's instructions.md with its tool list, so what the agent must say and do comes
 * with the tool's answer, where it always reaches the agent.
 */

/** What the person reads with a link code: the verified phone steps, no expiry time, a QR on request. */
export function linkCodeMessage(code: string): string {
  return [
    `Your WhatsApp link code: ${code}`,
    "",
    "On your phone:",
    "- Tap the \"Enter code to link new device\" notification from WhatsApp, or",
    "- Android: ⋮ (top right) > Linked devices > Link a device > Link with phone number instead",
    "- iPhone: Settings > Linked devices > Link device > Link with phone number instead",
    "",
    "Unlock, then type the code. If it doesn't work, just ask me for a new one.",
    "",
    "On a computer and rather scan a QR code? Just say so.",
  ].join("\n");
}

/** What the person reads with a QR code picture. */
export const QR_MESSAGE = "Open WhatsApp on your phone > Linked devices > Link a device, and scan this. Tell me when your chats show.";

/** What the agent does with a link code. */
export const LINK_CODE_STEPS = [
  "Send `tellThePerson` in the person's own chat with you only (the Flock app, or their own WhatsApp chat with you), never in a group or shared chat.",
  "This is a WhatsApp link code: WhatsApp made it for the person to type on their own phone, so posting it in chat is right here, the one exception to handing codes over in a window. Never post it anywhere else.",
  "Call it a \"link code\", never a verification code, OTP, security code or passcode. Never ask the person for a code.",
  "Then wait for them (a waiting-on-user question without codeValidMinutes), and run `link-status` when they say it's done. A new code is `link` again; at most 3 in a conversation, then offer the QR code.",
].join(" ");

/** What the agent does with a QR code picture. */
export const LINK_QR_STEPS = [
  "Show `qrImage` (a PNG data URL) as a picture in the person's own chat only, with `tellThePerson`.",
  "Someone reading the chat on their phone cannot scan a picture on that same phone: give them a link code instead.",
  "Starting a QR code cancelled any link code given before. Run `link-status` when they say it's done; a fresh QR code is `link` with qr: true again.",
].join(" ");
