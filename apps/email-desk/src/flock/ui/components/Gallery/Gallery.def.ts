import { z } from "zod";
import { defineComponent, fn, node } from "../../define";
import { Gallery } from "./Gallery";
import { expandedProp } from "../InlinePanel/InlinePanel.def";
export const GalleryDef = defineComponent({
  name: "Gallery", group: "data", component: Gallery,
  description: "A grid of image cards with a designed placeholder when an image is missing.",
  props: z.object({
    rows: z.array(z.record(z.string(), z.unknown())).describe("the records to show as cards"),
    image: fn<(row: any) => string | null>("image url for a card; null or empty shows the placeholder").optional(),
    object: fn<(row: any) => string | null | undefined>("object name drawn on a card with no image, on a tinted cover").optional(),
    title: fn<(row: any) => any>("card title"), meta: fn<(row: any) => any>("small line under the title").optional(),
    onClick: fn<(row: any) => void>("called when a card is clicked").optional(),
    loading: z.boolean().optional().describe("true shows a skeleton before the first rows arrive, and spins Load more after"),
    error: z.string().nullable().optional().describe("a load error; shown alone when there are no rows, otherwise as a notice under the grid"),
    empty: node("shown when there are no rows (an Empty with a hint and action)").optional(),
    hasMore: z.boolean().optional().describe("true shows Load more under the grid"), onLoadMore: fn<() => void>("called when Load more is clicked").optional(),
    columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional().describe("fixed column count; default fits as many as the width allows"),
    rowKey: fn<(row: any) => string>("stable key per row; defaults to row.id").optional(),
    expanded: expandedProp("as a full-width band right under the card whose key is `at`"),
  }),
  example: `<Gallery rows={recipes} image={(r) => r.cover} object={(r) => r.object} title={(r) => r.name} meta={(r) => r.time} />`,
});
