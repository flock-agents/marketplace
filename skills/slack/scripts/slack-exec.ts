const functionName = process.argv[2] || "";
const paramsArg = process.argv[3] || "{}";

if (!functionName) {
  console.error(JSON.stringify({ error: "Function name required. Usage: slack-exec.ts <function> <params_json>" }));
  process.exit(1);
}

let parsedParams: any;
try {
  parsedParams = JSON.parse(paramsArg);
} catch {
  parsedParams = {};
}

const body = JSON.stringify({
  skillId: "slack",
  functionName,
  instanceId: process.env.SKILL_ACCOUNT_ID || "",
  agentId: process.env.FLOCK_AGENT_ID || "",
  params: parsedParams,
});

(async () => {
  const apiBase = process.env.FLOCK_API_URL || process.env.FLOCK_API || "http://localhost:35625";
  const res = await fetch(`${apiBase}/api/internal/skill-exec`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.FLOCK_AUTH_TOKEN || ""}`,
    },
    body,
  });
  const text = await res.text();
  console.log(text);
})();
