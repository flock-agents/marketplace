// The defs of the components an agent may put in a chat block (CHAT_ALLOWLIST), and only those: the chat block frame
// imports this instead of src/registry.ts, so app-only components (AgentChat, AppShell, Board, Gallery, Toast, Confirm…)
// stay out of its script. Same def objects as the registry (chat-registry.test.ts holds the two together).
import type { ComponentDef } from "../define";
import { MiniAppDef, TabDef } from "../components/MiniApp/MiniApp.def";
import { QuestionsDef } from "../components/Questions/Questions.def";
import { BigCardDef } from "../components/BigCard/BigCard.def";
import { HeroStatDef } from "../components/HeroStat/HeroStat.def";
import { StatStripDef } from "../components/StatStrip/StatStrip.def";
import { ChartDef } from "../components/Chart/Chart.def";
import { ProgressDef, ProgressListDef } from "../components/Progress/Progress.def";
import { TableDef } from "../components/Table/Table.def";
import { LineItemsDef } from "../components/LineItems/LineItems.def";
import { RowListDef } from "../components/RowList/RowList.def";
import { CardDef } from "../components/Card/Card.def";
import { DetailDef } from "../components/Detail/Detail.def";
import { PropertyChipsDef } from "../components/PropertyChips/PropertyChips.def";
import { CalloutDef } from "../components/Callout/Callout.def";
import { ObjectIconDef } from "../components/ObjectIcon/ObjectIcon.def";
import { HeadingDef } from "../components/Heading/Heading.def";
import { MarkdownDef } from "../components/Markdown/Markdown.def";
import { BulletsDef } from "../components/Bullets/Bullets.def";
import { DividerDef } from "../components/Divider/Divider.def";
import { ColumnsDef } from "../components/Columns/Columns.def";
import { SectionDef } from "../components/Section/Section.def";
import { CalendarDef } from "../components/Calendar/Calendar.def";
import { ScheduleDef } from "../components/Schedule/Schedule.def";
import { ChoiceDef } from "../components/Choice/Choice.def";
import { ChecklistDef } from "../components/Checklist/Checklist.def";
import { FormDef } from "../components/Form/Form.def";
import { SlotPickerDef } from "../components/SlotPicker/SlotPicker.def";
import { ButtonDef } from "../components/Button/Button.def";
import { ItemPickerDef } from "../components/ItemPicker/ItemPicker.def";
import { ProductCardsDef } from "../components/ProductCards/ProductCards.def";

export const chatRegistry: ComponentDef<any>[] = [
  MiniAppDef, TabDef, QuestionsDef, BigCardDef, HeroStatDef, StatStripDef, ChartDef, ProgressDef, ProgressListDef, TableDef, LineItemsDef,
  RowListDef, CardDef, DetailDef, PropertyChipsDef, CalloutDef, ObjectIconDef, HeadingDef, MarkdownDef, BulletsDef, DividerDef, ColumnsDef,
  SectionDef, CalendarDef, ScheduleDef, ChoiceDef, ChecklistDef, FormDef, SlotPickerDef, ButtonDef, ItemPickerDef, ProductCardsDef,
];
