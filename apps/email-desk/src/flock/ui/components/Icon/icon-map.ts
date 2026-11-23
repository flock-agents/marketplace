import * as lucide from "lucide-react";
import { icons } from "lucide-react";

// Every lucide icon, for apps. The chat block frame swaps this module for icon-map.chat.ts (vite.chat-frame.config.ts),
// a generated subset, so each block's frame does not parse all ~1,900 icons.

/** The `icons` map first, then lucide's named exports, so alias names from the lucide docs (`history`, `trash-2`) resolve too.
 *  The fallback takes only real icons: every icon component has a displayName, while the other PascalCase exports (`Icon`, `LucideProvider`) do not. */
export function resolveIcon(name: string): any {
  const key = name.split("-").map((p) => (p[0]?.toUpperCase() ?? "") + p.slice(1)).join("");
  return (icons as Record<string, any>)[key] ?? (/^[A-Z]/.test(key) && (lucide as Record<string, any>)[key]?.displayName ? (lucide as Record<string, any>)[key] : undefined);
}
