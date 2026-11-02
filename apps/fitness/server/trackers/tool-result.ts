// What a Zepp action returned, as the platform hands it to the app: the tool's result, or why the call failed.
// Anything unreadable or failed becomes an error, never data.

/** One connector call's outcome: the platform's own call result (`ok` + the tool's result, or the reason it failed). */
export type ToolReply = { ok: true; data: unknown } | { ok: false; reason: string };
export type ToolResult = { ok: true; data: any } | { ok: false; error: string };

const parseJson = (text: string): unknown => { try { return JSON.parse(text); } catch { return undefined; } };

/** The tool's own JSON out of `{content: [{type: "text", text}], structuredContent}`. */
function unwrap(result: any): unknown {
  const text = result?.content?.find?.((c: any) => c?.type === "text")?.text;
  if (typeof text === "string") return parseJson(text) ?? text;
  return result?.structuredContent ?? result;
}

export function readToolResult(reply: ToolReply | undefined): ToolResult {
  if (!reply) return { ok: false, error: "no reply" };
  if (!reply.ok) return { ok: false, error: reply.reason };
  const result = reply.data as any;
  if (result?.isError) return { ok: false, error: String(unwrap(result)).slice(0, 200) };
  const data = unwrap(result) as any;
  if (!data || typeof data !== "object") return { ok: false, error: "empty reply" };
  if (data.status === "error") return { ok: false, error: data.error ?? data.note ?? "Zepp returned an error" };
  return { ok: true, data };
}
