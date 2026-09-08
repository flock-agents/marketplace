const params = JSON.parse(process.env.SKILL_PARAMS || "{}");

const body = JSON.stringify({
  skillId: "slack",
  functionName: "searchMessages",
  instanceId: process.env.SKILL_ACCOUNT_ID || "",
  agentId: process.env.FLOCK_AGENT_ID || "",
  params,
});

(async () => {
  const apiBase = process.env.FLOCK_API || "http://localhost:35625";
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
