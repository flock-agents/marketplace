import { z } from "zod";
import { defineComponent } from "../../define";
import { Skeleton } from "./Skeleton";
export const SkeletonDef = defineComponent({
  name: "Skeleton", group: "states", component: Skeleton,
  description: "Shimmering placeholder bars shown while data loads, in row, card or stat shape.",
  props: z.object({
    lines: z.number().int().positive().optional().describe("number of bars, default 3"),
    variant: z.enum(["row", "card", "stat"]).optional().describe("shape, default row"),
  }),
  example: `{loading ? <Skeleton variant="card" lines={4} /> : <Table … />}`,
});
