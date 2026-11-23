import { defineComponent } from "../../define";
import { Section } from "./Section";
import { SectionSchema } from "./Section.schema";
export const SectionDef = defineComponent({ ...SectionSchema, component: Section });
