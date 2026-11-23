import { z } from "zod";
import { defineComponent, fn } from "../../define";
import { ErrorCard } from "./ErrorCard";
export const ErrorCardDef = defineComponent({
  name: "ErrorCard", group: "states", component: ErrorCard,
  description: "A red alert for a failed load or save, with a Try again button when onRetry is given.",
  props: z.object({
    title: z.string().optional().describe("short lead"),
    message: z.string().describe("what went wrong, in plain words"),
    onRetry: fn<() => void>("runs when Try again is pressed").optional(),
  }),
  example: `<ErrorCard title="Could not load" message={error.message} onRetry={refetch} />`,
});
