import { z } from "zod";
import { defineSchema, fn } from "../../schema-def";
import { FieldTypeSchema } from "../Field/Field.schema";
export const FormSchema = defineSchema({
  name: "Form", group: "inputs",
  description: "A stack of Fields with a submit button; blocks on Required, shows server field errors, disables while saving.",
  chat: {
    use: "details to fill in (2 to 6 fields)",
    avoid: "one question with options (a Choice); a time (a SlotPicker)",
    needs: "each field `{type, name, label}` as data in `fields` (a Form lists its fields in `fields`; never a Field on its own), with `options` for select and multi; 2 to 6 fields; an `id`",
    example: {"type": "Form", "id": "add-expense", "props": {"submitLabel": "Add", "fields": [{"type": "text", "name": "item", "label": "What", "required": true}, {"type": "money", "name": "amount", "label": "Amount", "required": true}, {"type": "date", "name": "date", "label": "Date"}, {"type": "select", "name": "category", "label": "Category", "options": ["Groceries", "Bills", "Travel", "Eating out"]}]}},
  },
  props: z.object({
    fields: z.array(z.object({
      type: FieldTypeSchema, name: z.string(), label: z.string(), options: z.array(z.string()).optional(),
      required: z.boolean().optional(), error: z.string().nullable().optional(), placeholder: z.string().optional(),
    })).describe("the inputs, in order; each has a type, a name (the key in the submitted values), a label, and optionally options (select, multi), required, placeholder"),
    initial: z.record(z.string(), z.unknown()).optional().describe("starting values by field name"),
    onSubmit: fn("called with the values object; may return a promise, the button shows loading until it settles"),
    submitLabel: z.string().optional().describe("default Save"),
    onCancel: fn("shows a Cancel button when set").optional(),
    errors: z.record(z.string(), z.string()).optional().describe("server errors by field name, e.g. from a 400 { field, message }; cleared on edit"),
  }),
  example: `<Form fields={[{ type: "text", name: "item", label: "Item", required: true }, { type: "money", name: "budget", label: "Budget" }]} onSubmit={add} errors={serverErrors} />`,
});
