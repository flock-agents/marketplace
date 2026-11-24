import { z } from "zod";
import { defineComponent, fn } from "../../define";
import { Tone } from "../../tone";
import { Board } from "./Board";
import { expandedProp } from "../InlinePanel/InlinePanel.def";
export const BoardDef = defineComponent({
  name: "Board", group: "data", component: Board,
  description: "Cards in columns by a status field; drag or keyboard to move.",
  props: z.object({
    columns: z.array(z.object({ id: z.string(), label: z.string(), tone: Tone.optional() })).describe("the lanes, left to right: id, label and optional tone"),
    rows: z.array(z.record(z.string(), z.unknown())).describe("the records to place on cards"),
    columnOf: fn<(row: any) => string>("returns the id of the column a row belongs in"),
    card: fn<(row: any) => any>("renders the card body"),
    onMove: fn<(row: any, toColumn: string) => void>("called on drop, or when a column is picked from the Move to menu (focus a card, press .); omit for a read-only board").optional(),
    onCardClick: fn<(row: any) => void>("called when a card is clicked").optional(),
    rowKey: fn<(row: any) => string>("stable key per row; defaults to row.id").optional(),
    expanded: expandedProp("in the card's column, right under the card whose key is `at`"),
  }),
  example: `<Board columns={[{ id: "todo", label: "To do" }, { id: "done", label: "Done", tone: "success" }]} rows={tasks} columnOf={(t) => t.status} card={(t) => <b>{t.title}</b>} onMove={(t, to) => update(t.id, { status: to })} />`,
});
