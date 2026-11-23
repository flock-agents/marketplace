import { z } from "zod";
import { defineComponent, fn } from "../../define";
import { Search } from "./Search";
export const SearchDef = defineComponent({
  name: "Search", group: "inputs", component: Search,
  description: "A search box with a magnifier that calls onChange after the user pauses typing.",
  props: z.object({
    value: z.string().describe("the current search text"), onChange: fn("called with the text once typing pauses"),
    placeholder: z.string().optional().describe("also the accessible name; default Search"),
    debounceMs: z.number().optional().describe("pause before onChange fires; default 250, 0 for immediate"),
  }),
  example: `<Search value={q} onChange={setQ} placeholder="Search vendors" />`,
});
