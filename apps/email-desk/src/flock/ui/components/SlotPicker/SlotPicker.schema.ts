import { z } from "zod";
import { defineSchema, fn } from "../../schema-def";
export const SlotPickerSchema = defineSchema({
  name: "SlotPicker", group: "inputs",
  description: "One day's time slots as tappable chips; taken slots stay visible but cannot be picked.",
  chat: {
    use: "a time on one day, in a MiniApp whose title names the day",
    avoid: "a choice of days (a Choice); a time with no day named",
    needs: "`open` and `close` as HH:MM (24 hour), `slotMinutes` above 0, `taken` start times as HH:MM; the MiniApp around it titled with the day (\"Sat 15 Nov\"); an `id`",
    example: {"type": "MiniApp", "props": {"title": "Sat 15 Nov", "subtitle": "Glow Salon"}, "children": [{"type": "SlotPicker", "id": "salon-slot", "props": {"open": "10:00", "close": "20:00", "slotMinutes": 30, "taken": ["11:00", "16:00"]}}]},
  },
  props: z.object({
    open: z.string().describe("first start time of the day as 'HH:MM' (24 hour), e.g. '09:00'"),
    close: z.string().describe("closing time as 'HH:MM'; a slot must end by then"),
    slotMinutes: z.number().describe("minutes between slot starts, e.g. 30"),
    taken: z.array(z.string()).optional().describe("start times ('HH:MM') that cannot be picked; they show struck through"),
    past: z.array(z.string()).optional().describe("start times already gone today; disabled and read out as passed, and a day with none left says 'No more times today.'"),
    value: z.string().nullable().optional().describe("the picked start time 'HH:MM', or null"),
    onChange: fn("called with the picked start time 'HH:MM'"),
    length: z.number().optional().describe("minutes the booking needs, when longer than a slot; a slot that would end after closing is left out"),
    label: z.string().optional().describe("accessible name of the group; default 'Time slots'"),
  }),
  example: `<SlotPicker open="09:00" close="18:00" slotMinutes={30} taken={["10:00", "10:30"]} value={time} onChange={setTime} />`,
});
