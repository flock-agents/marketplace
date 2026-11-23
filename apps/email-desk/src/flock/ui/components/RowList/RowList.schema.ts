import { z } from "zod";
import { defineSchema, fn, node } from "../../schema-def";
import { expandedProp } from "../InlinePanel/InlinePanel.schema";
export const RowListSchema = defineSchema({
  name: "RowList", group: "data",
  description: "A list of rows with a title line, a meta line and leading/trailing slots.",
  chat: {
    use: "a short list, a note each",
    avoid: "more than 8 records with the same fields (a Table); items to tick off (a Checklist)",
    needs: "rows with `id`, `name` and `meta` (the note); an optional `value` with its `kind` shows at the right",
    example: {"type": "RowList", "props": {"rows": [{"id": "1", "name": "Plumber visit", "meta": "Tomorrow 10 AM", "value": 800, "kind": "money"}, {"id": "2", "name": "Gas refill", "meta": "Booked, Friday"}]}},
  },
  props: z.object({
    rows: z.array(z.record(z.string(), z.unknown())).describe("the rows loaded so far"),
    title: fn<(row: any) => any>("main line of a row"),
    meta: fn<(row: any) => any>("small grey line under the title").optional(),
    leading: fn<(row: any) => any>("left slot, e.g. an icon or avatar").optional(),
    trailing: fn<(row: any) => any>("right slot, e.g. a status pill or amount").optional(),
    onRowClick: fn<(row: any) => void>("called when a row is clicked or activated with Enter").optional(),
    loading: z.boolean().optional().describe("true while any page is fetching: skeleton when there are no rows yet, otherwise Load more spins"), error: z.string().nullable().optional().describe("shown instead of the list when there are no rows; with rows loaded it is a notice under them"),
    empty: node("shown when there are no rows").optional(),
    hasMore: z.boolean().optional().describe("true when the server has more pages"), onLoadMore: fn<() => void>("fetch the next page").optional(),
    rowKey: fn<(row: any) => string>("stable key per row; defaults to row.id").optional(),
    expanded: expandedProp("under the row whose key is `at`"),
  }),
  example: `<RowList rows={rows} title={(r) => r.name} meta={(r) => r.note} trailing={(r) => <Value kind="money" value={r.amount} />} />`,
});
