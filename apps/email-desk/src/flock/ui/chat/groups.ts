import type { ChatComponent } from "./allowlist";

/** The chat components by what an answer needs, each group with its "choose X vs Y" notes (r5-audit §2.10, the picking
 *  table). The agent's flock-blocks skill (server chat-blocks/prompt.ts) prints each group's name and notes over its
 *  components' entries. Every chat component is in exactly one group (groups.test.ts). */
export interface ChatGroup { name: string; components: readonly ChatComponent[]; notes: readonly string[] }

export const CHAT_GROUPS: readonly ChatGroup[] = [
  {
    name: "Pick", components: ["Choice", "Questions", "BigCard", "ItemPicker", "ProductCards"],
    notes: [
      "One question is a Choice; 2 to 6 questions that shape a plan are one Questions (never a Questions of one).",
      "Options, or a few compared (plans, rates, itineraries), are a Choice of cards with the same `facts` rows, never a Table; a highlighted option with nothing to pick is a BigCard.",
      "How many of each (a menu, a shop's results) is one ItemPicker, its sections as `group`s. A photo is an `image` on the item, card or row, never a markdown image. Clothes, shoes and anything with colours and sizes are one ProductCards of 3 to 5 items with every variant read; food and groceries stay an ItemPicker.",
    ],
  },
  {
    name: "Figures", components: ["HeroStat", "StatStrip", "Progress", "ProgressList"],
    notes: [
      "One main figure is a HeroStat; 2 to 5 are a StatStrip; never a StatStrip of one, never the same figure twice.",
      "Amounts against their own limits are a ProgressList; parts of one total are a share Chart, not a ProgressList against the total.",
    ],
  },
  {
    name: "Trends & parts", components: ["Chart"],
    notes: [
      "Numbers over time are a line Chart (5 or more points at even steps, oldest first); categories or a few periods a bar Chart; parts of a whole a share Chart (at most 6 slices).",
      "Never a Table or a sentence of numbers for a trend.",
    ],
  },
  {
    name: "Records", components: ["Table", "RowList", "Detail", "PropertyChips", "LineItems", "Card"],
    notes: [
      "More than 8 records with the same fields are a Table (at most 4 columns); a short list with a note each is a RowList.",
      "One thing's fields are a Detail, not a one-row Table or Bullets; 3 to 6 short facts are PropertyChips.",
      "A bill or quote is LineItems; one titled record with a meta line is a Card (a titled part of a frame is a Section).",
    ],
  },
  {
    name: "Plans & dates", components: ["Schedule", "Calendar"],
    notes: [
      "A plan on real dates is a Schedule on those dates (YYYY-MM-DD), not Questions; with no dates yet it is MiniApp tabs per day (at most 6) or a RowList, never \"Day 1\" as a date.",
      "Events across a month are a Calendar month; never the week-grid view in chat.",
    ],
  },
  {
    name: "Lists to keep", components: ["Checklist"],
    notes: ["A list to tick off is one Checklist in a MiniApp; its parts are `group`s, never several Checklists or Bullets."],
  },
  {
    name: "Frame & text", components: ["MiniApp", "Tab", "Section", "Columns", "Heading", "Markdown", "Bullets", "Callout", "Divider", "ObjectIcon"],
    notes: [
      "An answer in parts is a MiniApp; Tabs only for 2 to 6 parts, a single part goes straight in.",
      "A warning or caveat is a Callout or a caption inside the block, never prose after it.",
      "Markdown and Bullets are a few lines inside a block, never a table or a dated plan.",
    ],
  },
  {
    name: "Input", components: ["Form", "SlotPicker", "Button"],
    notes: [
      "Details to fill in are a Form (2 to 6 fields); a time on one day is a SlotPicker in a frame whose title names the day.",
      "Several actions are one Choice, not several Buttons.",
    ],
  },
];
