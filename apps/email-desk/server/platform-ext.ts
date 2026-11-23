// THE ONE SEAM for SDK features Flock is adding in the same release (plan Tasks 0.1, 1.4-1.6; ruling R3) that the SDK
// copy this app builds against does not have yet. Everything the app needs from them is typed HERE, against the plan's
// interfaces, and reached through `ext(...)` / `routineCtx(...)`, which only cast. When Flock's final shapes land, this file
// is the only one to change. Later tasks add their fields to the interfaces below (memory.extract's family fields,
// family.importEvents / family.targets, model.json); nothing else in the app declares platform shapes of its own.
import type { PlatformContext, Result, RoutineContext, SkillExecRequest } from "@flock/app-sdk";

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

export type PlatformExt = Omit<PlatformContext, "connectors"> & {
  connectors: Omit<PlatformContext["connectors"], "exec"> & ConnectorsExt;
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
