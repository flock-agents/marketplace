import { z } from "zod";
import { defineSchema, node } from "../../schema-def";
export const HeadingSchema = defineSchema({
  name: "Heading", group: "text",
  description: "Page or section title with an optional muted subtitle.",
  chat: {
    use: "a heading inside a MiniApp or Tab",
    avoid: "the top of a block (the MiniApp's title is its heading)",
    needs: "a few words as `children`; `level` 2 or 3",
    example: {"type": "MiniApp", "props": {"title": "Moving to Pune", "subtitle": "Flat in Baner from 1 Dec"}, "children": [{"type": "Heading", "props": {"level": 3, "children": "Before you go"}}, {"type": "Markdown", "props": {"text": "Give the landlord a month's notice and book the packers."}}, {"type": "Heading", "props": {"level": 3, "children": "After you land"}}, {"type": "Markdown", "props": {"text": "Move the gas connection and update the address on Aadhaar."}}]},
  },
  props: z.object({
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe("1 page title, 2 section (default), 3 sub-section"),
    children: node("the title text"),
    subtitle: z.string().optional().describe("one muted line under the title"),
  }),
  example: `<Heading level={1} subtitle="Updated just now">Good evening</Heading>`,
});
