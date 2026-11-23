/** What an agent may put in a ```flock-ui block. Exact list from the chat-blocks spec, less Field (owner 2026-10-21: a
 *  lone Field has no submit; a Form lists its fields as data in `fields`). */
export const CHAT_ALLOWLIST = [
  "MiniApp", "Tab", "Questions", "BigCard", "HeroStat", "StatStrip", "Chart", "Progress", "ProgressList", "Table", "LineItems",
  "RowList", "Card", "Detail", "PropertyChips", "Callout", "ObjectIcon", "Heading", "Markdown", "Bullets", "Divider", "Columns",
  "Section", "Calendar", "Schedule", "Choice", "Checklist", "Form", "SlotPicker", "Button", "ItemPicker", "ProductCards",
] as const;

/** Components that send an answer back to the agent; each needs a string `id` so the reply can name its block. */
export const REPLY_CAPABLE = ["Choice", "Questions", "Checklist", "Form", "SlotPicker", "Button", "ItemPicker", "ProductCards"] as const;

/** A block is at most this many nodes, UTF-8 bytes of the fence body, and levels deep (the root is level 1). */
// maxDepth 6 (owner 2026-10-21): a wireframe of an app screen nests MiniApp > Tab > Card > Columns > Section > a component;
// at 4 the Flock Assistant's wireframe was dropped from its question card.
// large (2026-10-25): a ProductCards block carries every colour, photo address and size variant of the 3 to 5 products read
// in full (up to 10 shown; the rest as the search listed them), so it
// alone may be up to 64 KB; any other block is held to maxBytes.
export const CHAT_LIMITS = { maxNodes: 40, maxBytes: 20_000, maxDepth: 6, large: { components: ["ProductCards"], maxBytes: 64_000 } } as const;

/** A block id: what the send route keeps as replyTo (server/src/chat-blocks/agent-lines.ts BLOCK_ID). */
export const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const BLOCK_ID_MESSAGE = "id is letters, digits, - and _ (at most 64)";

export type ChatComponent = (typeof CHAT_ALLOWLIST)[number];

/** A top-level node of these that carries a frame prop it does not take (LIFTED_PROPS) is drawn inside an
 *  implicit MiniApp holding those props, instead of being rejected (owner round 1, 2026-10-20). */
export const WRAPPABLE = ["Checklist", "Choice", "Form", "SlotPicker", "ItemPicker", "ProductCards"] as const;
export const LIFTED_PROPS = ["title", "subtitle", "makeApp"] as const;

/** Props the renderer sets (Rulings 1, 2, 11): an agent giving one is an error, never a dropped prop. */
export const RENDERER_OWNED: Partial<Record<ChatComponent, readonly string[]>> = {
  Choice: ["answer", "disabled"],
  Questions: ["answers", "disabled", "makeAppState"],
  MiniApp: ["makeAppState"],
  BigCard: ["as", "chosen", "faded", "badge"],
  ItemPicker: ["answer", "disabled", "collapseAfter"],
  ProductCards: ["answer", "disabled"],
};
