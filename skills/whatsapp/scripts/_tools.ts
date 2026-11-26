/**
 * WhatsApp: the tools agents call. Names and arguments match what Flock's WhatsApp gate checks
 * (read-chat's `chat`; list-chats' and search's `chats[].name`, search's `messages[].chat`; read-chat's
 * answer `chat` and `messages[]` with from, time and text), so an agent holding a shared WhatsApp only
 * reaches the chats it was given. There is no tool that adds people, makes groups, posts a status or
 * sends to a broadcast list.
 */
import type { Tool } from "./_mcp";
import type { WhatsAppService } from "./_whatsapp";

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, ...(required.length ? { required } : {}) });

export function whatsappTools(wa: WhatsAppService): Tool[] {
  return [
    {
      name: "link",
      description: "Link the person's WhatsApp to Flock. Gives an 8-character link code for their number right away (they type it on their phone), or a QR code picture with qr: true. The link waits a few minutes.",
      inputSchema: obj({
        phone: { type: "string", description: "The person's WhatsApp number with country code, such as +919812345678 (for a link code)" },
        qr: { type: "boolean", description: "true for a QR code picture instead of a link code" },
      }),
      run: (a) => wa.startLink(a),
    },
    {
      name: "link-status",
      description: "Whether WhatsApp is linked, and how a waiting link is doing (waiting, linked, expired or failed).",
      inputSchema: obj({}),
      run: () => wa.linkStatus(),
    },
    {
      name: "list-chats",
      description: "Recent WhatsApp chats and groups, newest first.",
      inputSchema: obj({ max: { type: "integer", description: "How many chats (default 20, at most 50)" } }),
      run: (a) => wa.listChats(a),
    },
    {
      name: "read-chat",
      description: "The last messages of one chat or group, oldest first. Photos, voice messages and documents are short placeholders; nothing is downloaded.",
      inputSchema: obj({
        chat: { type: "string", description: "The chat's name exactly as list-chats shows it" },
        count: { type: "integer", description: "How many messages (default 10, at most 30)" },
      }, ["chat"]),
      run: (a) => wa.readChat(a),
    },
    {
      name: "search",
      description: "Find chats by name and messages by their words.",
      inputSchema: obj({
        query: { type: "string", description: "The words to look for" },
        max: { type: "integer", description: "How many of each (default 10, at most 30)" },
      }, ["query"]),
      run: (a) => wa.search(a),
    },
    {
      name: "send-message",
      description: "Send one text message the person approved to one chat they already have. One chat per send.",
      inputSchema: obj({
        chat: { type: "string", description: "The chat's name exactly as list-chats shows it" },
        text: { type: "string", description: "The message, exactly as the person approved it" },
      }, ["chat", "text"]),
      run: (a) => wa.sendMessage(a),
    },
    {
      name: "unlink",
      description: "Unlink WhatsApp from Flock and forget every stored chat.",
      inputSchema: obj({}),
      run: () => wa.unlink(),
    },
  ];
}
