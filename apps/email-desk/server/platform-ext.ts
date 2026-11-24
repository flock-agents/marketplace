// THE ONE SEAM for platform reads the SDK does not have (ruling R3, aligned with the SDK by ruling R20). Everything the SDK
// types (connectors.readTurn, connectors.accounts, exec's `turnId`, memory.extract's `familyCandidates` and its
// MemoryExtractAnswer, family.importEvents / targets, model.json) is used as the SDK's, never declared here. What is left
// is what no SDK call gives yet, each optional so a Flock without it answers nothing and the app falls back:
//   - family.context() and family.household() (ruling R9): who the family is, for the personal rules and the import;
//   - identity.names() (ruling R10): the person's own names;
//   - board.openTasks() (ruling R12): the person's open TODOs by thread, for closure;
//   - `turnId` on a routine context's exec: the SDK's routine ctx drops it, so routineCtx() runs the call through
//     platform.connectors.exec, which takes it, as the SDK's routine ctx does otherwise.
import type { PlatformContext, Result, RoutineContext } from "@flock/app-sdk";
import type { FamilyContext } from "./lib/personal-mail-rules";

// ---- optional reads (rulings R9, R10): who the family is, and the person's own names ----------------------------------
// Their shapes are this app's proposal; Part 3 aligns them with whatever Flock ships.

export interface FamilyExtras {
  /** The family the personal-mail rules need: everyone's names and addresses, and the school's domains. */
  context?(): Promise<Result<FamilyContext>>;
  /** Who a Family Calendar item may be for (#370 family-context.ts householdNames): Flock's people, the owner, and the
   *  family Memory knows from a chat. First names. */
  household?(): Promise<Result<{ names: string[] }>>;
}

export interface IdentityExt {
  /** The person's names (full name, the name they are called): what makes bulk mail personal when it names them. */
  names?(): Promise<Result<{ names: string[] }>>;
}

// ---- the person's open TODOs by thread (closure, ruling R12) -----------------------------------------------------------
// The extraction closes a TODO once the thread shows it done, but only a TODO it is shown (item `context.openTasks`, app
// callers only). Those TODOs are Flock's board rows (source "gmail"), not this app's, so `tasks.list` cannot see them.
// Without this read nothing is closed by the app's extraction.
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

/** The SDK's platform, plus the optional reads above. The SDK's `family` methods stay as the SDK types them; the whole of
 *  `family` is optional there (an older Flock), and so are its methods here (a fake that serves only some). */
export type PlatformExt = Omit<PlatformContext, "family"> & {
  family?: Partial<NonNullable<PlatformContext["family"]>> & FamilyExtras;
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

/** The SDK's read-turn answer (a refusal is its failed Result, `code` busy / quarantined / not_yours). An alias only. */
export type ReadTurnResult = Awaited<ReturnType<NonNullable<PlatformContext["connectors"]["readTurn"]>>>;
/** What a read turn answers on a Flock whose SDK has none (`readTurn` is optional in the SDK): refused, nothing is read. */
export const NO_READ_TURNS: ReadTurnResult = { ok: false, reason: "this Flock has no read turns" };

export function ext(platform: PlatformContext): PlatformExt {
  return platform as unknown as PlatformExt;
}

/** The routine's context with `turnId` reaching the platform: the exec goes to platform.connectors.exec as the SDK's own
 *  routine ctx sends it (this routine's id, the account as the hint, the timeout), plus the turn. Everything else is the
 *  routine's own. */
export function routineCtx(ctx: RoutineContext | RoutineCtx): RoutineCtx {
  const platform = ctx.platform as PlatformContext;
  return {
    ...(ctx as RoutineContext),
    platform: ext(platform),
    connectors: {
      exec: <T = unknown>(skillId: string, functionName: string, params?: Record<string, unknown>, opts?: { account?: string; timeoutMs?: number; turnId?: string }) =>
        platform.connectors.exec<T>({
          skillId, functionName, params: params ?? {}, routineId: ctx.routine.id,
          ...(opts?.account ? { accountHint: opts.account } : {}),
          ...(opts?.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
          ...(opts?.turnId ? { turnId: opts.turnId } : {}),
        }),
    },
  };
}
