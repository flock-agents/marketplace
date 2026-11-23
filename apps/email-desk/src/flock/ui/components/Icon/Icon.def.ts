import { z } from "zod";
import { defineComponent } from "../../define";
import { IconName } from "../../tone";
import { Icon } from "./Icon";
export const IconDef = defineComponent({
  name: "Icon", group: "media", component: Icon,
  description: "A Lucide line icon by kebab-case name; use it below 24px, objects are for larger spots.",
  props: z.object({
    name: IconName,
    size: z.number().optional().describe("pixels, default 16"),
  }),
  example: `<Icon name="calendar-days" size={16} />`,
});
