// The manifest against what the server serves: every declared op, routine, published skill and lifecycle hook has its code,
// and the code serves nothing the manifest does not account for. The served-but-undeclared ops are exactly the Op contract's
// send_draft (reached only by the card's Send) and the platform read ops (reached only by Flock's server).
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { allOps, routineHandlers, routineHours } from "../registry";
import { createEmailDeskHooks } from "../lifecycle";

const ROOT = join(import.meta.dir, "../..");
const manifest = JSON.parse(readFileSync(join(ROOT, "flock.app.json"), "utf-8"));

const AGENT_OPS = ["reply_context", "create_draft", "update_draft", "discard_draft"];
const SERVED_ONLY = [
  "send_draft",
  "newest_thread_message", "thread_body", "store_thread_body", "last_harvest", "follow_up_kind", "draft_send_recorded",
  "mailboxes", "bundle_rows", "engaged_domains",
  // The owner's upgrade only (Flock migrations/email-desk-marketplace.ts).
  "republish_legacy_card", "import_voice",
];

const sorted = (a: Iterable<string>) => [...a].sort();
const declaredOps = (): string[] => manifest.agentInterface.operations.map((o: { name: string }) => o.name);
const skillText = (id: string) => readFileSync(join(ROOT, "skills", id, "instructions.md"), "utf-8");
const routine = (id: string) => manifest.routines.find((r: { id: string }) => r.id === id);

describe("ops: the manifest and the server agree", () => {
  test("the declared ops are exactly the four agent ops", () => {
    expect(sorted(declaredOps())).toEqual(sorted(AGENT_OPS));
  });

  test("every declared op has a handler", () => {
    for (const name of declaredOps()) expect(typeof allOps[name]).toBe("function");
  });

  test("every handler is declared, or is send_draft or a platform op", () => {
    const undeclared = Object.keys(allOps).filter((name) => !declaredOps().includes(name));
    expect(sorted(undeclared)).toEqual(sorted(SERVED_ONLY));
  });
});

describe("routines: the manifest and the server agree", () => {
  test("every routine's handler is served, and every served handler is a routine's", () => {
    const named = manifest.routines.map((r: { handler: string }) => r.handler);
    expect(sorted(named)).toEqual(sorted(Object.keys(routineHandlers)));
    for (const h of named) expect(typeof routineHandlers[h]).toBe("function");
  });

  test("a routine's workSchedule.hourKey is the setting its handler runs its day at", () => {
    const scheduled = manifest.routines.filter((r: { workSchedule?: { hourKey?: string } }) => r.workSchedule?.hourKey);
    expect(scheduled.length).toBeGreaterThan(0);
    for (const r of scheduled) {
      const key: string = r.workSchedule.hourKey;
      expect(r.configSchema.map((c: { key: string }) => c.key)).toContain(key);
      const hourOf = routineHours[r.handler];
      expect(typeof hourOf).toBe("function");
      for (const h of [0, 7, 13, 23]) expect({ routine: r.id, hour: hourOf!({ [key]: h }) }).toEqual({ routine: r.id, hour: h });
      const fallback = r.configSchema.find((c: { key: string }) => c.key === key).default;
      expect({ routine: r.id, hour: hourOf!({}) }).toEqual({ routine: r.id, hour: fallback });
    }
  });

  test("memory-extraction wakes the agent with a prompt that names both skills", () => {
    const p: string = routine("memory-extraction").prompt;
    expect(typeof p).toBe("string");
    expect(p).toContain("mails");
    expect(p).toContain("judge-mail");
    expect(p).toContain("write-reply");
  });

  test("follow-up never wakes the agent, so it carries no prompt", () => {
    expect(routine("follow-up").prompt).toBeUndefined();
  });
});

describe("published skills", () => {
  test("every published skill has its instructions file, and every skills/ folder is published", () => {
    const ids: string[] = manifest.publishedSkills.map((s: { id: string }) => s.id);
    for (const id of ids) {
      expect(existsSync(join(ROOT, "skills", id, "instructions.md"))).toBe(true);
      expect(skillText(id).trim().length).toBeGreaterThan(200);
    }
    expect(sorted(readdirSync(join(ROOT, "skills")))).toEqual(sorted(ids));
  });

  test("write-reply says how to draft, change and never send", () => {
    const t = skillText("write-reply");
    for (const must of ["reply_context", "create_draft", "update_draft", "VOICE_LEARNING", "DRAFT_EXISTS", "PLACEHOLDER", "Send", "*send*"]) {
      expect(t).toContain(must);
    }
    expect(t).not.toContain("send_draft");
    // A refused agent that cannot come back is not stuck: the offer comes again. A gone draft is written again.
    expect(t).toContain("If you cannot come back later, leave it; Email Desk offers it again.");
    expect(t).toContain("If it answers `NOT_FOUND`, the draft is gone: write the reply again with `create_draft`.");
  });

  test("judge-mail reads the thread with reply_context and hands over to write-reply", () => {
    const t = skillText("judge-mail");
    expect(t).toContain("reply_context");
    expect(t).toContain("write-reply");
    expect(t).not.toContain("send_draft");
    // Never both "no draft is open" and "when existingDraft is not null" (R: a stale draft never mutes a thread).
    expect(t).not.toContain("no draft is open for the thread");
  });
});

describe("lifecycle: the manifest and the server agree", () => {
  test("every declared hook is served, and every served hook is declared", () => {
    const hooks = createEmailDeskHooks({ platform: () => null as never }) as unknown as Record<string, unknown>;
    for (const name of ["initialize", "tick", "progress"]) {
      expect(manifest.lifecycle[name] === true).toBe(typeof hooks[name] === "function");
    }
  });
});

describe("owner-facing copy", () => {
  const texts = (): Array<[string, string]> => [
    ["description", manifest.description],
    ...manifest.routines.flatMap((r: { id: string; description: string; prompt?: string }) =>
      [[`${r.id} description`, r.description], ...(r.prompt ? [[`${r.id} prompt`, r.prompt]] : [])] as Array<[string, string]>),
    ...manifest.publishedSkills.map((s: { id: string }) => [`skill ${s.id}`, skillText(s.id)] as [string, string]),
  ];

  test("no em or en dashes, and no double hyphens", () => {
    for (const [where, t] of texts()) {
      expect({ where, dash: /[—–]|--/.test(t) }).toEqual({ where, dash: false });
    }
  });

  test("never names a specific agent: the copy is whichever agent it is paired with", () => {
    for (const [where, t] of texts()) {
      expect({ where, named: /Butler|Inbox Assistant|Personal Assistant/i.test(t) }).toEqual({ where, named: false });
    }
  });

  test("the routine descriptions say when they run", () => {
    expect(routine("memory-extraction").description).toMatch(/hour you pick/i);
    expect(routine("memory-extraction").description).toMatch(/every hour/i);
    expect(routine("memory-extraction").description).toMatch(/new mail/i);
    expect(routine("follow-up").description).toMatch(/new mail/i);
    expect(routine("follow-up").description).toMatch(/once a day/i);
  });
});
