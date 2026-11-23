import { z } from "zod";
import { defineComponent, node } from "../../define";
import { Page } from "./Page";
export const PageDef = defineComponent({
  name: "Page", group: "frame", component: Page,
  description: "The frame of one app page: a title, a subtitle, an actions slot and the content.",
  props: z.object({
    title: z.string().optional().describe("page heading, rendered as the h1"),
    subtitle: z.string().optional().describe("one muted line under the title"),
    actions: node("buttons shown at the right of the heading").optional(),
    width: z.enum(["narrow", "wide", "full"]).optional().describe("wide (default), narrow, full"),
    children: node("the page content"),
  }),
  example: `<Page title="Launch tracker" subtitle="6 workstreams" actions={<Button>New</Button>}>…</Page>`,
});
