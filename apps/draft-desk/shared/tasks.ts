// Platform Task + Widget shapes Draft Desk produces (§5.2, §7.4 of the spec). These mirror the
// platform's contract for the app-facing task publish and the declarative widget data endpoint.
// Kept minimal — only the fields Draft Desk actually emits.

// One resolvable action attached to a task (keyed by a STABLE id; resolution is by id, never
// array index — §5.2). Draft Desk emits two: "Approve & send" (a side-effecting script_then_agent
// action the platform executor runs on approval) and "Review & edit" (a link into the workbench).
export interface ActionSpec {
  id: string;
  label: string;
  kind: "primary" | "secondary" | "link" | "danger";
  // The platform refuses to resolve a requiresContext action when task.context is null — an
  // approval must always ride its justifying context (§2 principle #2, §9).
  requiresContext?: boolean;
  // send/post → must ride a user-approved action; the platform mints an approval-context token
  // and requires it for the side-effecting skill call (§10 T4).
  sideEffect?: boolean;
  executor: ActionExecutor;
}

export interface ActionExecutor {
  mode: "inline" | "script" | "agent" | "script_then_agent" | "link";
  // The granted skill this action drives (gmail | linkedin | twitter), per the draft's source.
  skill?: string;
  scriptName?: string;
  args?: string[];
  // Duplicate submits collapse to one side effect (§9 idempotency).
  idempotencyKey?: string;
  onFailure?: "agent" | "retry" | "needs_user";
  // Immutable at task creation (§5.2, §10 T2) — the seed for the escalation session if the script
  // send fails.
  agentSeed?: string;
  // mode=link destination (the workbench deep-link).
  href?: string;
}

// --- Declarative widget data (§7.4) ---
// The platform fetches the app's widget dataUrl server-side and renders it with themed components
// (stat / list / action-row templates). The app returns this structured content — never HTML.

export interface WidgetStat {
  label: string;
  value: string | number;
}

export interface WidgetAction {
  id: string;
  label: string;
  kind?: "primary" | "secondary" | "link" | "danger";
  href?: string;
}

// One row in a list widget — a projection of a pending-approval draft.
export interface WidgetListItem {
  id: string;
  title: string;
  subtitle?: string;
  preview?: string;
  badge?: string;
  actions?: WidgetAction[];
}

export interface WidgetData {
  // The declarative template the platform renders with. Draft Desk uses "list" with a header stat.
  template: "list";
  title: string;
  stat?: WidgetStat;
  items: WidgetListItem[];
  emptyText?: string;
}
