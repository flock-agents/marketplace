import { z } from "zod";
import { defineSchema } from "../../schema-def";
export const MarkdownSchema = defineSchema({
  name: "Markdown", group: "text",
  description: "Formatted text from markdown; raw HTML is dropped and only http, https and mailto links are kept.",
  chat: {
    use: "a few lines of text inside a block",
    avoid: "a table (a Table or cards); a day plan with dates (a Schedule); the text around the block",
    needs: "`text` of 6 lines at most; never a markdown table",
    example: {"type": "Section", "props": {"title": "Why Airtel"}, "children": [{"type": "Markdown", "props": {"text": "**Fastest for the price.** No lock-in, so you can switch if night speeds drop."}}]},
  },
  props: z.object({ text: z.string().describe("markdown source, e.g. an agent's reply or a note") }),
  example: `<Markdown text={"**Next step:** [open the brief](https://example.com)"} />`,
});
