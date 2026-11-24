import { z } from "zod";
import { defineSchema, fn } from "../../schema-def";
export const ChecklistSchema = defineSchema({
  name: "Checklist", group: "records",
  description: "Tick-off items with an optional detail line, groups, a progress bar and an inline add row.",
  chat: {
    use: "a list to tick off, inside a MiniApp",
    avoid: "several Checklists in one block (one Checklist with `group`s); Bullets",
    needs: "`items` of `{id, label, done: false}`, with a `group` each and `grouped: true` when the list has parts; 20 items at most; an `id`; the title (and makeApp) on the MiniApp around it",
    example: {"type": "MiniApp", "id": "pack", "props": {"title": "Packing", "makeApp": true}, "children": [{"type": "Checklist", "id": "items", "props": {"grouped": true, "items": [{"id": "1", "label": "Rain jackets", "done": false, "group": "Clothes"}, {"id": "2", "label": "Snacks", "done": false, "group": "Kids"}]}}]},
  },
  props: z.object({
    items: z.array(z.object({ id: z.string(), label: z.string(), done: z.boolean(), meta: z.string().optional().describe("one line of detail under the label"), group: z.string().optional(), sample: z.boolean().optional().describe("pass the row's _sample: shown lighter with a Sample chip") })).describe("the items: id, label, done, and optionally meta, group and sample"),
    onToggle: fn("called with (id, done) where done is the new state"),
    onAdd: fn("called with (label, group?) when Enter is pressed in the add row; the row only shows when this is set").optional(),
    style: z.enum(["task", "note"]).optional().describe("task has square boxes (default), note has round ones"),
    grouped: z.boolean().optional().describe("one heading per item group, with a done count"),
    showProgress: z.boolean().optional().describe("a 'N of M' line and a progress bar on top"),
  }),
  example: `<Checklist items={rows.map((r) => ({ id: r.id, label: r.title, done: r.done }))} onToggle={(id, done) => save(id, { done })} showProgress />`,
});
