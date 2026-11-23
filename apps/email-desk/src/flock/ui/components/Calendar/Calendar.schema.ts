import { z } from "zod";
import { defineSchema, fn, node } from "../../schema-def";
import { Tone } from "../../tone";
import { expandedProp } from "../InlinePanel/InlinePanel.schema";
export const CalendarSchema = defineSchema({
  name: "Calendar", group: "data",
  description: "Dates as a month, a week strip, a week grid or a day timeline. For a weekly plan prefer Schedule; keep week-grid as its option.",
  chat: {
    use: "events across a month, or a few days of timed events",
    avoid: "a plan on real dates (a Schedule); the week-grid view (too wide for chat); dates not known yet",
    needs: "rows with `id`, `date` YYYY-MM-DD, `title` and an optional `time` HH:MM; every date a real one",
    example: {"type": "Calendar", "props": {"view": "month", "rows": [{"id": "1", "date": "2026-11-04", "title": "Rent due"}, {"id": "2", "date": "2026-11-15", "title": "Coorg trip", "time": "07:00"}]}},
  },
  props: z.object({
    view: z.enum(["month", "schedule", "week-grid", "timeline"]).describe("month grid, schedule (week strip + that day's list), week-grid (days × lanes, e.g. meals), timeline (grouped by day)"),
    rows: z.array(z.any()).describe("the records to place on dates"),
    date: fn("(row) => ISO date 'YYYY-MM-DD' the row falls on"),
    title: fn("(row) => what to show for the row (ReactNode)"),
    time: fn("(row) => 24h HH:MM time text such as '09:30'; rows sort by it within a day").optional(),
    tone: fn(`(row) => ${Tone.options.join(" | ")}; colours the row's edge`).optional(),
    lane: fn("(row) => which lane the row belongs to, for week-grid").optional(),
    lanes: z.array(z.string()).optional().describe("week-grid lane order, e.g. ['Breakfast','Lunch','Dinner']; default is the order lanes first appear"),
    icon: fn("(row) => lucide icon name shown as a tinted tile before the title (timeline)").optional(),
    trailing: fn("(row) => ReactNode placed at the end of the row, e.g. a vote button; clicks on it do not select the row (timeline)").optional(),
    selectedId: z.string().optional().describe("id of the picked row; highlighted in timeline, schedule, week-grid and month"),
    weekStart: z.string().optional().describe("ISO date of the Monday the week starts on (schedule, week-grid); month shows this date's month"),
    today: z.string().optional().describe("ISO date to mark as today with the app accent"),
    onSelect: fn("(row) => void, called when a row is picked").optional(),
    onAdd: fn("(date, lane?) => void, called from the + on an empty day or cell").optional(),
    expanded: expandedProp("(timeline and schedule views) under the row whose id is `at`"),
  }),
  example: `<Calendar view="week-grid" rows={meals} date={(m) => m.date} title={(m) => m.dish} lane={(m) => m.slot} lanes={["Breakfast","Lunch","Dinner"]} weekStart="2026-10-05" today="2026-10-08" onAdd={(d, slot) => addMeal(d, slot)} />`,
});
