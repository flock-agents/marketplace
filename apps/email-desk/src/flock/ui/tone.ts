import { z } from "zod";
export const Tone = z.enum(["neutral","accent","success","warning","danger","info","muted"]);
export const Size = z.enum(["sm","md","lg"]);
export const Density = z.enum(["compact","comfortable"]);
export const Emphasis = z.enum(["plain","subtle","strong"]);
export const Width = z.enum(["auto","narrow","wide","full"]);
export const Align = z.enum(["start","center","end"]);
export const IconName = z.string().describe("a lucide icon name, kebab-case, e.g. 'calendar-days'");
export type ToneT = z.infer<typeof Tone>;
export function cx(...parts: (string | false | null | undefined)[]): string { return parts.filter(Boolean).join(" "); }
