import { z } from "zod";
import { defineSchema, fn } from "../../schema-def";
import { Tone } from "../../tone";
import { expandedProp } from "../InlinePanel/InlinePanel.schema";
export const ScheduleSchema = defineSchema({
  name: "Schedule", group: "data",
  description: "Dated items one block per day from today, today and tomorrow big, later days compact; the default for any weekly plan.",
  chat: {
    use: "a plan on real dates (YYYY-MM-DD); with no dates yet, a day plan is tabs or a RowList",
    avoid: "dates not known yet (\"Day 1\", \"Sat\"): MiniApp tabs per day or a RowList; events across a month (a Calendar)",
    needs: "rows with `id`, `date` YYYY-MM-DD and `title`, one row per item; optional `time` (HH:MM or \"9 – 10am\"), `meta` (a place or note), `slot` (e.g. \"Breakfast\") with `slots` for their order; 14 days at most",
    example: {"type": "Schedule", "props": {"rows": [{"id": "1", "date": "2027-01-07", "time": "10:30", "title": "Land in Goa", "meta": "GOI"}, {"id": "2", "date": "2027-01-07", "time": "16:00", "title": "Candolim beach"}, {"id": "3", "date": "2027-01-08", "time": "09:00", "title": "Old Goa churches"}]}},
  },
  props: z.object({
    rows: z.array(z.any()).describe("the records to place on dates"),
    date: fn("(row) => ISO date 'YYYY-MM-DD' the row falls on"),
    title: fn("(row) => what to show for the row (ReactNode)"),
    time: fn("(row) => left label shown as text, such as '10 – 11am' or '09:30'; it is display only").optional(),
    start: fn("(row) => start of the row for ordering within a day: 'HH:MM' or minutes since midnight; default reads the leading time of `time` ('9 – 10am' before '10 – 11am', '9am' before '1pm')").optional(),
    secondary: fn("(row) => muted text after the title (location, notes, tags); shown in full on today and tomorrow").optional(),
    tone: fn(`(row) => ${Tone.options.join(" | ")}; colours the row's dot and edge`).optional(),
    icon: fn("(row) => lucide icon name shown as a tinted tile on today and tomorrow").optional(),
    trailing: fn("(row) => ReactNode placed at the end of the row, e.g. a vote button; clicks on it do not select the row").optional(),
    slot: fn("(row) => which slot the row fills, e.g. 'Breakfast'; shown as its left label").optional(),
    slots: z.array(z.string()).optional().describe("slot order such as ['Breakfast','Lunch','Dinner']; today and tomorrow then show an inviting '+ Add breakfast' row for each empty slot"),
    today: z.string().optional().describe("ISO date of today; default is the viewer's local date, refreshed at midnight"),
    from: z.string().optional().describe("ISO date the list starts on; default is today. Days before today fold behind an 'Earlier' toggle"),
    days: z.number().int().min(1).max(60).optional().describe("how many days to show from `from`; default 7"),
    showEarlier: z.boolean().optional().describe("start with the days before today open instead of folded, e.g. when browsing a past week"),
    selectedId: z.string().optional().describe("id of the picked row; highlighted"),
    onSelect: fn("(row) => void, called when a row is picked").optional(),
    onAdd: fn("(date, slot?) => void, called from an add row or the Add button of a day").optional(),
    rowKey: fn("(row) => stable key per row; defaults to row.id").optional(),
    expanded: expandedProp("under the row whose key is `at`, or under the '+ Add' whose `scheduleAddKey(date, slot?)` is `at` (a folded empty day unfolds for it)"),
  }),
  example: `<Schedule rows={meals} date={(m) => m.date} title={(m) => m.dish} slot={(m) => m.slot} slots={["Breakfast","Lunch","Dinner"]} secondary={(m) => m.cook && \`\${m.cook} cooks\`} days={7} onAdd={(d, slot) => setAdding({ d, slot })} onSelect={openMeal}
  expanded={adding ? { at: scheduleAddKey(adding.d, adding.slot), label: "Add a meal", onClose: () => setAdding(null), content: <MealForm … /> } : null} />`,
});
