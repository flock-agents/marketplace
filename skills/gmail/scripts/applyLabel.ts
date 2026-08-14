import {
  errorJson,
  requireBrowserSession,
  validateId,
  browserInteract,
} from "../../_shared/_google_helpers";

const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
const messageId: string = params.messageId || "";
const labelName: string = params.labelName || "";

requireBrowserSession();

if (!messageId || !labelName) {
  errorJson("MISSING_PARAM", "messageId and labelName are required");
}
validateId(messageId, "messageId");

const labelNameJson = JSON.stringify(labelName);

const actions = [
  { action: "wait", delay: 3000 },
  { action: "evaluate", script: `(() => { const btn = document.querySelector("[aria-label=\\"Labels\\"]") || document.querySelector("[data-tooltip=\\"Labels\\"]"); if (btn) { btn.click(); return {ok:true}; } return {ok:false,message:"Labels button not found"}; })()` },
  { action: "wait", delay: 1500 },
  { action: "evaluate", script: `(() => { const searchInput = document.querySelector(".bqf input") || document.querySelector("[aria-label=\\"Label search\\"] input"); if (searchInput) { searchInput.value = ${labelNameJson}; searchInput.dispatchEvent(new Event("input",{bubbles:true})); } return {ok:true}; })()` },
  { action: "wait", delay: 1000 },
  { action: "evaluate", script: `(() => { const target = ${labelNameJson}; const labels = document.querySelectorAll(".J-N-Jz, .brC-brG-btb"); for (const l of labels) { if (l.textContent?.trim() === target) { l.click(); return {ok:true,message:"Label selected"}; } } const checkboxes = document.querySelectorAll(".J-Kh-Jt input[type=checkbox]"); for (const cb of checkboxes) { const label = cb.closest(".J-N")?.querySelector(".J-N-Jz"); if (label && label.textContent?.trim() === target) { cb.click(); return {ok:true,message:"Label checkbox toggled"}; } } return {ok:false,message:"Label not found in dropdown"}; })()` },
  { action: "wait", delay: 500 },
  { action: "evaluate", script: `(() => { const applyBtn = document.querySelector(".brC-aMv-auR[role=button]") || Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim() === "Apply"); if (applyBtn) { applyBtn.click(); return {ok:true}; } return {ok:true,message:"No apply button — label may have auto-applied"}; })()` },
  { action: "wait", delay: 1500 },
];

const evalScript = `(() => { return JSON.stringify({ success: true, message: 'Label applied via browser session' }); })()`;

(async () => {
  const result = await browserInteract(
    `https://mail.google.com/mail/u/0/#inbox/${messageId}`,
    actions,
    undefined,
    evalScript,
  );
  const content = result?.content || "{}";
  const parsed = typeof content === "string" ? JSON.parse(content) : content;
  console.log(JSON.stringify(parsed));
})();
