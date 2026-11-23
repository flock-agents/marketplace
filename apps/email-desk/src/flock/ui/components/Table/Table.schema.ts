import { ValueKindSchema } from "../Value/kind";
import { z } from "zod";
import { defineSchema, fn, node } from "../../schema-def";
import { Tone, Density } from "../../tone";
import { expandedProp } from "../InlinePanel/InlinePanel.schema";
export const TableSchema = defineSchema({
  name: "Table", group: "data",
  description: "Rows and columns from one table; values formatted by kind; paged with Load more.",
  chat: {
    use: "many rows of records (a statement, a log), never a few options compared",
    avoid: "2 to 8 options compared (a Choice of cards with `facts`); one record (a Detail); a short list with a note each (a RowList)",
    needs: "at most 4 columns (on a phone each row becomes a card); every column `key` a field on the rows; an `id` per row; amounts as JSON numbers in a column with `kind` money and `align` end",
    example: {"type": "Table", "props": {"columns": [{"key": "item", "label": "Item"}, {"key": "amount", "label": "Amount", "kind": "money", "align": "end"}], "rows": [{"id": "1", "item": "Netflix", "amount": 649}, {"id": "2", "item": "Spotify", "amount": 119}]}},
  },
  props: z.object({
    rows: z.array(z.record(z.string(), z.unknown())).describe("the rows loaded so far: an id and one field per column key each"),
    columns: z.array(z.object({
      key: z.string().describe("field name on the row"), label: z.string(),
      kind: ValueKindSchema.optional().describe("how to show the value: text (default), number, money, compact, signed, percent (signed change, +12.0%), share (plain 64%), date, select, multi, person, url, checkbox, minutes"),
      tones: z.record(z.string(), Tone).optional().describe("for kind select: option -> tone"),
      labels: z.record(z.string(), z.string()).optional().describe("for kind select: stored value -> the words shown"),
      align: z.enum(["start", "end"]).optional().describe("end for numbers"),
      width: z.enum(["auto", "narrow", "wide"]).optional(),
      phone: z.literal("hide").optional().describe("hide this column from the row cards shown on phones (up to 720px); on phones each row is a card: the wide (else first) column is the title, an align end column sits at the right of it, select/multi/person/date values are chips, the rest are Label: value lines"),
      render: fn<(row: any) => any>("custom cell; replaces the kind formatting. In phone cards use native controls (a, button, input) or role/tabindex for clickable content so it works on its own").optional(),
    })).describe("the columns, in order: key (row field), label, and optionally kind, tones, labels, align, width, phone, render"),
    onRowClick: fn<(row: any) => void>("called with the row clicked or activated with Enter").optional(),
    selectedId: z.string().optional().describe("id of the highlighted row"),
    loading: z.boolean().optional().describe("true while any page is fetching: skeleton when there are no rows yet, otherwise Load more spins"), error: z.string().nullable().optional().describe("shown instead of the table when there are no rows; with rows loaded it is a notice under them"),
    empty: node("shown when there are no rows").optional(),
    hasMore: z.boolean().optional().describe("true when the server has more pages"),
    onLoadMore: fn<() => void>("fetch the next page; the Load more button calls it").optional(),
    density: Density.optional().describe("comfortable (default) or compact row height"), rowKey: fn<(row: any) => string>("stable key per row; defaults to row.id").optional(),
    expanded: expandedProp("under the row whose key is `at` (a full-width row on desktop, under the card on phones)"),
  }),
  example: `<Table rows={rows} columns={[{ key: "name", label: "Name" }, { key: "amount", label: "Amount", kind: "money", align: "end" }]} hasMore={hasMore} onLoadMore={loadMore}
  expanded={editing ? { at: editing.id, label: \`Edit \${editing.name}\`, onClose: () => setEditing(null), content: <Card title="Edit"><Form … onCancel={() => setEditing(null)} /></Card> } : null} />`,
});
