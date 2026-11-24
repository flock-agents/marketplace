import { z } from "zod";
import { defineComponent } from "../../define";
import { AvatarStack } from "./AvatarStack";
export const AvatarStackDef = defineComponent({
  name: "AvatarStack", group: "media", component: AvatarStack,
  description: "Overlapping initials avatars for a set of people, with a +N for the rest.",
  props: z.object({
    people: z.array(z.object({ name: z.string() })).describe("people to show, in order"),
    max: z.number().int().positive().optional().describe("avatars shown before +N, default 4"),
  }),
  example: `<AvatarStack people={[{ name: "Asha" }, { name: "Ben" }]} />`,
});
