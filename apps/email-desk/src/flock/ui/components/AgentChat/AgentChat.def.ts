import { z } from "zod";
import { defineComponent } from "../../define";
import { AgentChat } from "./AgentChat";
export const AgentChatDef = defineComponent({
  name: "AgentChat", group: "frame", component: AgentChat,
  description: "Chat with the app's agent, beside the data or as a page; sends the open record as context, shows changed rows with Undo, lists saved chats.",
  props: z.object({
    placement: z.enum(["side", "page"]).describe("side: a docked panel (the shell turns it into a launcher on phones); page: conversation list and thread side by side"),
    context: z.object({ table: z.string(), id: z.string(), label: z.string().describe("shown on the chip, e.g. 'Villa Azul'") }).nullable().optional().describe("the record the viewer is looking at; sent with each message until the chip is cleared"),
    starters: z.array(z.string()).optional().describe("suggested first messages, shown on an empty conversation"),
    title: z.string().optional().describe("header text; default 'Ask <agent name>'"),
  }),
  example: `<AppShell name="Villas" chat={{ placement: "side", render: () => <AgentChat placement="side" context={selected ? { table: "villas", id: selected.id, label: selected.name } : null} /> }}>…</AppShell>`,
});
