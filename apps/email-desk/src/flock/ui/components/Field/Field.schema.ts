import { z } from "zod";
import { defineSchema, fn } from "../../schema-def";
export const FieldTypeSchema = z.enum(["text", "longtext", "number", "money", "date", "select", "multi", "checkbox", "person", "url"]);
export const FieldSchema = defineSchema({
  name: "Field", group: "inputs",
  description: "One labelled input of a given type, with an error tied to it. Controlled: you own value and onChange.",
  props: z.object({
    type: FieldTypeSchema.describe("number and money give onChange a number or null; date gives an ISO string; multi gives a string array"),
    name: z.string().describe("the input's name attribute; with a Form, the key in the submitted values"), label: z.string().describe("text shown above the input"), value: z.unknown().describe("current value; its shape follows type"), onChange: fn("called with the new value, or null when emptied"),
    options: z.array(z.string()).optional().describe("select and multi: the choices. text: suggestions only (a datalist; any text is accepted)"),
    optionLabels: z.record(z.string(), z.string()).optional().describe("select only: the words shown for an option's value (the value stays what was stored)"),
    required: z.boolean().optional().describe("marks the field as required"), error: z.string().nullable().optional().describe("shown under the field and read out with it"),
    placeholder: z.string().optional().describe("hint text shown while the input is empty"),
    onInvalid: fn("number and money only: called with true while the typed text is not a number, false otherwise").optional(),
  }),
  example: `<Field type="money" name="budget" label="Budget" value={budget} onChange={setBudget} error={err} />`,
});
