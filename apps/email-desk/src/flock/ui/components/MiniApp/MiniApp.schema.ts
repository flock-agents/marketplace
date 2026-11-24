import { z } from "zod";
import { defineSchema, fn, node } from "../../schema-def";
export const MiniAppSchema = defineSchema({
  name: "MiniApp", group: "frame",
  description: "A small framed app for a chat reply: a title, optional pill tabs (Tab children), and a Make it an app button.",
  chat: {
    kids: `Tab blocks {label} each holding components, or components`,
    use: "a framed answer in parts (a summary, a plan, a list)",
    avoid: "one question (a Choice) or options compared (a Choice of cards); a lone Tab (put the part straight in the MiniApp)",
    needs: "a `title` of 2 to 4 words; a `subtitle` with the facts (dates, people); Tab children only for 2 to 6 parts, else the content directly; an `id` when makeApp is set",
    example: {"type": "MiniApp", "id": "oct", "props": {"title": "October", "subtitle": "Spend so far", "makeApp": true}, "children": [{"type": "Tab", "props": {"label": "Total"}, "children": [{"type": "HeroStat", "props": {"label": "Spent", "value": 86100, "kind": "money"}}]}, {"type": "Tab", "props": {"label": "Split"}, "children": [{"type": "Chart", "props": {"type": "share", "kind": "money", "data": [{"label": "Rent", "v": 38000}, {"label": "Food", "v": 14200}], "series": [{"key": "v", "label": "Spent"}]}}]}]},
  },
  props: z.object({
    title: z.string().describe("the frame's title"),
    subtitle: z.string().optional().describe("small caps line above the title"),
    makeApp: z.boolean().optional().describe("show the 'Make it an app' button"),
    onMakeApp: fn("called when 'Make it an app' is pressed").optional(),
    children: node("Tab elements, or any content when there are no tabs"),
  }),
  example: `<MiniApp title="Coorg weekend" subtitle="15–16 Nov" makeApp><Tab label="Plan">…</Tab><Tab label="Costs">…</Tab></MiniApp>`,
});
export const TabSchema = defineSchema({
  name: "Tab", group: "frame",
  description: "One pill tab inside MiniApp; its children show when the tab is open.",
  chat: {
    kids: `components`,
    use: "one part of a MiniApp",
    avoid: "outside a MiniApp; a single Tab; more than 6 Tabs (later ones scroll out of sight on a phone)",
    needs: "`label` of 1 or 2 words; `count` a short string",
    example: {"type": "MiniApp", "props": {"title": "Coorg weekend", "subtitle": "4 of us, by car"}, "children": [{"type": "Tab", "props": {"label": "Day 1", "count": "3"}, "children": [{"type": "Markdown", "props": {"text": "Abbey Falls in the morning, lunch at Raintree, sunset at Raja's Seat."}}]}, {"type": "Tab", "props": {"label": "Day 2", "count": "2"}, "children": [{"type": "Markdown", "props": {"text": "Dubare elephant camp at 8, then the drive home."}}]}]},
  },
  props: z.object({
    label: z.string().describe("the tab's text"),
    count: z.string().optional().describe("a small count or note after the label"),
    children: node("the tab's content"),
  }),
  example: `<Tab label="Plan" count="3">…</Tab>`,
});
