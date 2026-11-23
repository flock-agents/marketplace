import { z } from "zod";
import { defineSchema, fn, node } from "../../schema-def";
export const QuestionsSchema = defineSchema({
  name: "Questions", group: "inputs",
  description: "2 to 6 Choice questions as pill tabs with one Submit; an answer ticks its tab and moves on.",
  chat: {
    kids: `2 to 6 Choice blocks, each with props.tab`,
    use: "2 to 6 questions that shape a plan, a tab each",
    avoid: "one question (a Choice); a plan whose dates and choices are already given (answer with the plan)",
    needs: "2 to 6 Choice children, each with a `tab` of 1 or 2 words and one `question`; real options as cards (named stays with prices, routes with times), not categories; an `id`",
    example: {"type": "Questions", "id": "goa-picks", "props": {"title": "Goa trip"}, "children": [{"type": "Choice", "props": {"tab": "Stay", "question": "Where?", "options": [{"title": "Taj Village", "value": 18000, "kind": "money", "unit": "/ night", "caption": "On the beach"}, {"title": "Ahilya", "value": 12500, "kind": "money", "caption": "Quiet, 9 rooms"}]}}, {"type": "Choice", "props": {"tab": "Travel", "question": "How?", "options": [{"title": "IndiGo 7:10", "value": 6400, "kind": "money", "caption": "1 h 15"}, {"title": "Drive", "caption": "9 hours"}]}}]},
  },
  props: z.object({
    title: z.string().optional().describe("the frame's title"),
    subtitle: z.string().optional().describe("small caps line above the title"),
    makeApp: z.boolean().optional().describe("show the 'Make it an app' button"),
    submitLabel: z.string().optional().describe("the Submit button's text; default 'Send answers'"),
    onChange: fn("called with all answers so far, keyed by tab label, on every pick, write or change"),
    onSubmit: fn("called once with all answers when Submit is pressed"),
    onMakeApp: fn("called when 'Make it an app' is pressed").optional(),
    children: node("2 to 6 Choice elements; each one's tab (else question) is its tab label and its answer key"),
  }),
  example: `<Questions title="Plan the trip" onChange={save} onSubmit={send}><Choice tab="Dates" question="When?" options={["Sat", "Sun"]} /><Choice tab="Budget" question="How much?" options={["Low", "High"]} /></Questions>`,
});
