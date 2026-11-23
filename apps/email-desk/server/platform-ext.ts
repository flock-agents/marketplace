// THE ONE SEAM for SDK features Flock is adding in the same release (plan Tasks 0.1, 1.4-1.6; ruling R3) that the SDK
// copy this app builds against does not have yet. Everything the app needs from them is typed HERE, against the plan's
// interfaces, and reached through `ext(...)` / `routineCtx(...)`, which only cast. When Flock's final shapes land, this file
// is the only one to change. Nothing else in the app declares platform shapes of its own.
// The SDK now has `platform.model.json` (used as the SDK's, never declared here) and `connectors.readTurn` (its refusal
// `code` an untyped string; the typed form below is kept so gather.ts and its tests are unchanged: Part 3 may drop it).
import type { PlatformContext, Result, RoutineContext, SkillExecRequest } from "@flock/app-sdk";
import type { FamilyContext } from "./lib/personal-mail-rules";

// ---- connectors.readTurn (plan Task 1.4): the mailbox lease, the subprocess form of Flock's account-turn ---------------

/** The platform's refusals of a read turn. `busy`: another consumer holds the mailbox now. `quarantined`: Flock paused the
 *  account (a sign-in wall). `not_yours`: the account is not this copy's person's. */
export type ReadTurnRefusalCode = "busy" | "quarantined" | "not_yours";

export interface ReadTurn {
  turnId: string;
  accountId: string;
  /** Idempotent; never throws. */
  release(): Promise<void>;
}

/** A refused turn, in the SDK Result's failure arm with the platform's code and, when it gave one, when to try again. */
export type ReadTurnRefusal = {
  ok: false;
  skipped?: false;
  status?: number;
  reason: string;
  message?: string;
  code: ReadTurnRefusalCode;
  retryAfterMs?: number;
};

export type ReadTurnResult = Result<ReadTurn> | ReadTurnRefusal;

/** One account the paired agent holds for a skill (plan Task 1.5). */
export interface ConnectorAccount {
  accountId: string;
  email: string | null;
  label: string | null;
}

export interface ConnectorsExt {
  /** Take the mailbox for `consumer` (e.g. "email-desk:harvest"). Never blocks: a held mailbox answers `busy`. */
  readTurn(accountHint: string | undefined, consumer: string, opts?: { skillId?: string; ttlMs?: number }): Promise<ReadTurnResult>;
  accounts(skillId: string): Promise<Result<{ accounts: ConnectorAccount[] }>>;
  /** As the SDK's, plus `turnId`: the call runs under that held read turn instead of queueing for the mailbox. */
  exec<T = unknown>(req: SkillExecRequest & { timeoutMs?: number; turnId?: string }): Promise<Result<T>>;
}

// ---- optional reads (rulings R9, R10): who the family is, and the person's own names ----------------------------------
// Optional on purpose: a Flock without them answers nothing, and the app falls back (fail open). Their shapes are this app's
// proposal; Part 3 aligns them with whatever Flock ships.

export interface FamilyExt {
  /** The family the personal-mail rules need: everyone's names and addresses, and the school's domains. */
  context?(): Promise<Result<FamilyContext>>;
  /** Who a Family Calendar item may be for (#370 family-context.ts householdNames): Flock's people, the owner, and the
   *  family Memory knows from a chat. First names. Not in the plan's Task 1.6: this app's proposal (ruling R9's kind). */
  household?(): Promise<Result<{ names: string[] }>>;
  /** Plan Task 1.6: the Family Calendars this copy's person may import into, the oldest group's first. */
  targets?(): Promise<Result<{ appIds: string[] }>>;
  /** Plan Task 1.6: the one import_events call, through Flock's gate (importRefusal; at most 50 items and 32 KB). */
  importEvents?(payload: ImportPayload): Promise<Result<{ answer: unknown }>>;
}

// ---- memory.extract with family candidates (plan Task 1.6) -------------------------------------------------------------
// The SDK's memory.extract takes any `source` and answers any T; these are the shapes this app sends and reads. With
// `source.familyCandidates: true` (a personal mailbox) Flock writes the facts and to-dos as today, but hands the family ones
// back in `family.blocks` instead of pushing them itself: the app plans and imports them (family/push.ts).

export type DateRole = "deadline" | "milestone" | "appointment" | "travel" | "occasion" | "renewal";
export interface FactWhenWire { date: string; time?: string | null; tz?: string | null; end?: string | null; recurrence?: "yearly" | null }
/** An extracted fact as Flock's extraction gives it (wiki-extraction-prompts ExtractedFactWithSupersedes): the fields the
 *  family push reads. */
export interface ExtractedFactWire {
  content: string;
  kind?: string | null;
  dateRole?: DateRole | null;
  salience?: number | null;
  when?: FactWhenWire | null;
  entities: Array<{ name: string; type: string }>;
  audience?: "family" | "personal";
  supersedes?: string;
}
/** An extracted to-do (wiki-extraction-prompts ExtractedTask): the fields the family push and the Home fallback read. */
export interface ExtractedTaskWire {
  title: string;
  detail?: string | null;
  /** YYYY-MM-DD, or a full ISO instant when a time is given; null when neither. */
  due?: string | null;
  audience?: "family" | "personal";
}
/** One mail's family items (plan Task 1.6, exact): facts already event-gated and scrubbed; to-dos Flock held off Home. */
export interface FamilyBlockWire {
  blockId: string;
  facts: ExtractedFactWire[];
  heldTasks: ExtractedTaskWire[];
  ctx: { threadKey: string; messageId: string | null; mailDate: string; sender: string };
}
/** /api/memory/extract's answer (routes/memory-extract.ts), plus `family` (Task 1.6). */
export interface ExtractAnswer {
  ok?: boolean;
  processedItems?: number;
  failedItems?: number;
  deferredItems?: number;
  facts?: { written?: number };
  tasks?: { created?: number; closed?: number };
  family?: { blocks: FamilyBlockWire[] };
}

// ---- the Family Calendar's import_events payload (Family Calendar 3.0.0 contract) ---------------------------------------
export interface ImportTodo { title: string; due?: string }
export interface ImportItem {
  ref: string;
  match: string[];
  kind: "event" | "deadline";
  title: string;
  date: string;
  start_time?: string;
  who?: string;
  location?: string;
  notes?: string;
  todos?: ImportTodo[];
}
export interface ImportPayload { source: string; label: string; items: ImportItem[] }

// ---- the person's open TODOs by thread (closure, ruling R12) -----------------------------------------------------------
// The extraction closes a TODO once the thread shows it done, but only a TODO it is shown (item `context.openTasks`, app
// callers only). Those TODOs are Flock's board rows (source "gmail"), not this app's, so `tasks.list` cannot see them. No
// SDK call reads them yet: a missing Part 1 piece, proposed here. Without it nothing is closed by the app's extraction.
export interface OpenTaskWire {
  id: string;
  threadKey: string;
  title: string;
  why?: string;
  /** The message of the thread the ask came from, as Flock stored it when it made the TODO. */
  anchor?: number | null;
  createdAt: number;
}
export interface BoardExt {
  openTasks?(req: { connectorSkill: string; threadKeys: string[] }): Promise<Result<{ tasks: OpenTaskWire[] }>>;
}

export interface IdentityExt {
  /** The person's names (full name, the name they are called): what makes bulk mail personal when it names them. */
  names?(): Promise<Result<{ names: string[] }>>;
}

export type PlatformExt = Omit<PlatformContext, "connectors"> & {
  connectors: Omit<PlatformContext["connectors"], "exec"> & ConnectorsExt;
  family?: FamilyExt;
  identity?: IdentityExt;
  board?: BoardExt;
};

/** A routine's context with the extended platform, and `turnId` on its exec. */
export type RoutineCtx = Omit<RoutineContext, "platform" | "connectors"> & {
  readonly platform: PlatformExt;
  connectors: {
    exec<T = unknown>(
      skillId: string,
      functionName: string,
      params?: Record<string, unknown>,
      opts?: { account?: string; timeoutMs?: number; turnId?: string },
    ): Promise<Result<T>>;
  };
};

export function ext(platform: PlatformContext): PlatformExt {
  return platform as unknown as PlatformExt;
}

export function routineCtx(ctx: RoutineContext): RoutineCtx {
  return ctx as unknown as RoutineCtx;
}
