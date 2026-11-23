// ObjectIcon's picture names, for the validator. The pictures are read through vite's import.meta.glob
// (objects-index.ts), which only a vite build has, so the validator never imports them: where the names are known
// (the chat frame's render.tsx, the library's tests) they are registered here. With none registered the list is
// empty and the validator skips the name check.
let provider: (() => string[]) | null = null;
/** The registered provider's names, or [] when none is registered. */
export function chatObjectNames(): string[] {
  return provider ? provider() : [];
}
/** Registers where the names come from (the last call wins). */
export function setChatObjectNames(fn: () => string[]): void {
  provider = fn;
}
