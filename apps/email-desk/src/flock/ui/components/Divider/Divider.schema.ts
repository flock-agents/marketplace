import { z } from "zod";
import { defineSchema } from "../../schema-def";
export const DividerSchema = defineSchema({
  name: "Divider", group: "text",
  description: "A thin rule between groups of content.",
  chat: {
    use: "a rule between groups",
    avoid: "the top or the end of a block",
    needs: "no props",
    example: {"type": "MiniApp", "props": {"title": "This month's bills", "subtitle": "November"}, "children": [{"type": "HeroStat", "props": {"label": "Due", "value": 14250, "kind": "money"}}, {"type": "Divider"}, {"type": "RowList", "props": {"rows": [{"id": "1", "name": "Electricity", "meta": "BESCOM, due 18 Nov", "value": 2350, "kind": "money"}, {"id": "2", "name": "Maintenance", "meta": "Society, due 20 Nov", "value": 11900, "kind": "money"}]}}]},
  },
  props: z.object({}),
  example: `<Divider />`,
});
