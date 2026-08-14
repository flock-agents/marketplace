import { apiPost } from "../../_shared/_google_helpers";

const functionName = process.argv[2] || "";
const paramsArg = process.argv[3] || "{}";

if (!functionName) {
  console.error(JSON.stringify({ error: "Function name required. Usage: gmail-exec.ts <function> <params_json>" }));
  process.exit(1);
}

let parsedParams: any;
try {
  parsedParams = JSON.parse(paramsArg);
} catch {
  parsedParams = {};
}

const body = JSON.stringify({
  skillId: "gmail",
  functionName,
  instanceId: process.env.SKILL_ACCOUNT_ID || "",
  agentId: process.env.FLOCK_AGENT_ID || "",
  params: parsedParams,
});

(async () => {
  const result = await apiPost("/api/internal/skill-exec", body);
  console.log(result);
})();
