// The schemas of the components an agent may put in a chat block, in chatRegistry's order, without their React
// components: the validator (validate.ts) reads these, so it runs where React and vite do not (the Flock server).
// Nothing reachable from here imports React or a .tsx file (__tests__/schemas-no-react.test.ts).
import type { ChatSchemaDef } from "../schema-def";
import { MiniAppSchema, TabSchema } from "../components/MiniApp/MiniApp.schema";
import { QuestionsSchema } from "../components/Questions/Questions.schema";
import { BigCardSchema } from "../components/BigCard/BigCard.schema";
import { HeroStatSchema } from "../components/HeroStat/HeroStat.schema";
import { StatStripSchema } from "../components/StatStrip/StatStrip.schema";
import { ChartSchema } from "../components/Chart/Chart.schema";
import { ProgressSchema, ProgressListSchema } from "../components/Progress/Progress.schema";
import { TableSchema } from "../components/Table/Table.schema";
import { LineItemsSchema } from "../components/LineItems/LineItems.schema";
import { RowListSchema } from "../components/RowList/RowList.schema";
import { CardSchema } from "../components/Card/Card.schema";
import { DetailSchema } from "../components/Detail/Detail.schema";
import { PropertyChipsSchema } from "../components/PropertyChips/PropertyChips.schema";
import { CalloutSchema } from "../components/Callout/Callout.schema";
import { ObjectIconSchema } from "../components/ObjectIcon/ObjectIcon.schema";
import { HeadingSchema } from "../components/Heading/Heading.schema";
import { MarkdownSchema } from "../components/Markdown/Markdown.schema";
import { BulletsSchema } from "../components/Bullets/Bullets.schema";
import { DividerSchema } from "../components/Divider/Divider.schema";
import { ColumnsSchema } from "../components/Columns/Columns.schema";
import { SectionSchema } from "../components/Section/Section.schema";
import { CalendarSchema } from "../components/Calendar/Calendar.schema";
import { ScheduleSchema } from "../components/Schedule/Schedule.schema";
import { ChoiceSchema } from "../components/Choice/Choice.schema";
import { ChecklistSchema } from "../components/Checklist/Checklist.schema";
import { FormSchema } from "../components/Form/Form.schema";
import { SlotPickerSchema } from "../components/SlotPicker/SlotPicker.schema";
import { ButtonSchema } from "../components/Button/Button.schema";
import { ItemPickerSchema } from "../components/ItemPicker/ItemPicker.schema";
import { ProductCardsSchema } from "../components/ProductCards/ProductCards.schema";

export const chatSchemas: ChatSchemaDef[] = [
  MiniAppSchema, TabSchema, QuestionsSchema, BigCardSchema, HeroStatSchema, StatStripSchema, ChartSchema, ProgressSchema, ProgressListSchema, TableSchema, LineItemsSchema,
  RowListSchema, CardSchema, DetailSchema, PropertyChipsSchema, CalloutSchema, ObjectIconSchema, HeadingSchema, MarkdownSchema, BulletsSchema, DividerSchema, ColumnsSchema,
  SectionSchema, CalendarSchema, ScheduleSchema, ChoiceSchema, ChecklistSchema, FormSchema, SlotPickerSchema, ButtonSchema, ItemPickerSchema, ProductCardsSchema,
];
