import { z } from "zod";
import { defineSchema, fn, node } from "../../schema-def";
export const InlinePanelSchema = defineSchema({
  name: "InlinePanel", group: "records",
  description: "An add or edit form opened in place under the item clicked: focuses its first field, Escape closes, focus goes back.",
  props: z.object({
    children: node("the form or detail, usually a Card"),
    onClose: fn("() => void, called on Escape; close the panel here, as Cancel does"),
    label: z.string().optional().describe("the panel's accessible name, e.g. 'Edit Rice'"),
    className: z.string().optional().describe("extra class for custom layout"),
  }),
  example: `{goals.map((g) => <Fragment key={g.id}><GoalRow goal={g} onEdit={() => setEditing(g.id)} />{editing === g.id ? <InlinePanel label={\`Edit \${g.goal}\`} onClose={() => setEditing(null)}><Card title="Edit goal"><Form … /></Card></InlinePanel> : null}</Fragment>)}`,
});

/** The `expanded` prop the list components share. */
export const expandedProp = (where: string) => z.object({
  at: z.string().describe("the row's key (its id)"),
  content: node("the form or detail to show, usually a Card holding a Form"),
  onClose: fn("() => void, called on Escape: close it as Cancel does"),
  label: z.string().optional().describe("accessible name, e.g. 'Edit Rice'"),
}).nullable().optional().describe(`opens content in place ${where}, pushing the rows below down: the add or edit form for the row clicked, never one at the top of the page. It focuses its first field, Escape calls onClose, and focus returns to the control clicked`);
