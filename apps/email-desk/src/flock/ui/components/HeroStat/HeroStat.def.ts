import { defineComponent } from "../../define";
import { HeroStat } from "./HeroStat";
import { HeroStatSchema } from "./HeroStat.schema";
export const HeroStatDef = defineComponent({ ...HeroStatSchema, component: HeroStat });
