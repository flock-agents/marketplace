// What a rule is about (docs/2026-11-26-one-meaning-model-design.md §5.2): exactly one target. Task 3 adds the functions that read them.
export type RuleTarget =
  | { type: "kind"; kind: string }
  | { type: "sub"; kind: string; sub: string }
  | { type: "item"; item: string; kind: string | null }
  | { type: "ingredient"; tag: string };
