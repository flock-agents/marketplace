import { z } from "zod";
import { defineComponent } from "../../define";
import { Tone } from "../../tone";
import { Value, Avatar } from "./Value";
import { ValueKindSchema } from "./kind";
export const ValueDef = defineComponent({
  name: "Value", group: "values", component: Value,
  description: "Renders one value by kind: money with Indian grouping, compact ₹L/Cr, dates as relative, selects as pills, people as avatars.",
  props: z.object({
    kind: ValueKindSchema.describe("how to show the value; percent = signed change (+12.0%, green or red), share = plain 64%"),
    value: z.unknown().describe("the raw value; empty shows a muted dash"),
    tones: z.record(z.string(), Tone).optional().describe("select only: option → tone"),
    labels: z.record(z.string(), z.string()).optional().describe("select only: stored value → the words shown (a renamed stage); an unlisted value shows as stored"),
    today: z.string().optional().describe("ISO date used as 'today' (tests, fixed dashboards)"),
  }),
  example: `<Value kind="compact" value={275000} />  // ₹2.75L`,
});
export const AvatarDef = defineComponent({
  name: "Avatar", group: "media", component: Avatar,
  description: "A round initials avatar whose colour is stable for a given name.",
  props: z.object({
    name: z.string().describe("person's name; the first letter is shown"),
    size: z.enum(["sm", "md"]).optional().describe("default sm"),
  }),
  example: `<Avatar name="Asha" />`,
});
