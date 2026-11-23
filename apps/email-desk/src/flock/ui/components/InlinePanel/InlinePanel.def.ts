import { defineComponent } from "../../define";
import { InlinePanel } from "./InlinePanel";
import { InlinePanelSchema } from "./InlinePanel.schema";
export { expandedProp } from "./InlinePanel.schema";
export const InlinePanelDef = defineComponent({ ...InlinePanelSchema, component: InlinePanel });
