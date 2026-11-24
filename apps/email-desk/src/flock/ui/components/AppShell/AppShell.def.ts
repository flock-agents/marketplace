import { z } from "zod";
import { defineComponent, node, fn } from "../../define";
import { AppShell, ACCENT_NAMES } from "./AppShell";
export const AppShellDef = defineComponent({
  name: "AppShell", group: "frame", component: AppShell,
  description: "The app's frame: header with object icon and sharers, page navigation (none, top tabs or left nav) and the agent chat placement.",
  props: z.object({
    name: z.string().describe("the app's name, shown in the header (not inside Flock, whose bar already names the app: there the header goes and the tabs come first)"),
    subtitle: z.string().optional().describe("one muted line under the name"),
    object: z.string().optional().describe("object sticker name for the header, e.g. 'house'"),
    nav: z.enum(["auto", "none", "top", "side"]).optional().describe("auto (default): 1 page none, 2-4 top tabs, 5+ left nav (left nav when chat is a page)"),
    pages: z.array(z.object({ id: z.string(), label: z.string(), icon: z.string().optional().describe("lucide icon name") })).optional().describe("the pages to navigate between"),
    current: z.string().optional().describe("id of the current page"),
    onNavigate: fn<(id: string) => void>("called with the id of the page chosen").optional(),
    people: z.array(z.object({ name: z.string() })).optional().describe("people the app is shared with, shown as avatars"),
    accent: z.enum(ACCENT_NAMES).optional().describe("the app's own accent by name: coral (default), teal, blue, green, violet or amber; set once, never a hex colour"),
    chat: z.object({ placement: z.enum(["side", "page"]), render: fn<() => unknown>("returns the AgentChat element") }).optional().describe("agent chat: a side panel (a launcher on phones) or its own page"),
    settings: z.object({ render: fn<() => unknown>("returns the app's own settings page") }).optional().describe("the owner's Settings & routines page: inside Flock the signed-in owner gets a last page \"Settings\" (Flock's own page for this app by default; visitors never see it); pass only to draw your own"),
    theme: z.enum(["system", "light", "dark"]).optional().describe("system (default), light or dark; the viewer can switch"),
    children: node("the current page's content"),
  }),
  example: `<AppShell name="Budgets" object="wallet" pages={pages} current={page} onNavigate={setPage} chat={{ placement: "side", render: () => <AgentChat /> }}>…</AppShell>`,
});
