import { z } from "zod";
import { defineSchema, fn } from "../../schema-def";
import { BigCardFields } from "../BigCard/BigCard.schema";
const card = z.object(BigCardFields);
export const ChoiceSchema = defineSchema({
  name: "Choice", group: "inputs",
  description: "A question with 2 to 8 options, as buttons or big cards, plus a field to write your own answer.",
  chat: {
    use: "one question, 2 to 8 options",
    avoid: "2 to 6 questions (a Questions); an \"Other\" option (every Choice takes a written answer); products to buy (a ProductCards)",
    needs: "a `question` of 8 words at most; options all plain strings (days, times, names) or all cards (BigCard props) when they differ in price, place or features; option titles unique and short (the title is the reply); an `id` (none inside Questions)",
    example: {"type": "Choice", "id": "cleaner-time", "props": {"question": "When should the cleaner come?", "options": ["Sat 10 AM", "Sat 4 PM", "Sun 11 AM"]}},
  },
  props: z.object({
    question: z.string().optional().describe("the question, shown above the options"),
    tab: z.string().optional().describe("short tab label when this question sits inside Questions"),
    options: z.union([z.array(z.string()).min(2).max(8), z.array(card).min(2).max(8)]).describe("2 to 8 options: all plain strings, or all cards (title is what gets sent back)"),
    multi: z.boolean().optional().describe("allow several picks, sent together with the submit button"),
    write: z.boolean().optional().describe("show the 'Or write your own answer…' field; default true"),
    submitLabel: z.string().optional().describe("multi only: the submit button's text; default 'Send'"),
    onAnswer: fn("called with { picked: string[] } or { written: string }"),
  }),
  example: `<Choice question="When suits you?" options={["Sat 4pm", "Sun 11am"]} onAnswer={(a) => send(a)} />`,
});
