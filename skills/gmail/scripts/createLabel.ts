import {
  errorJson,
  requireBrowserSession,
  browserInteract,
} from "../../_shared/_google_helpers";
import { markThenClick, markThenType } from "./_gmailPress";

const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
const labelName: string = params.name || "";

requireBrowserSession();

if (!labelName) {
  errorJson("MISSING_PARAM", "name is required");
}

const labelNameJson = JSON.stringify(labelName);

const actions = [
  { action: "wait", delay: 2000 },
  ...markThenClick("more", `(() => { const moreBtn = document.querySelector(".CL[aria-label=\\"More\\"]") || document.querySelector(".aim .TN[data-tooltip=\\"More\\"]"); if (moreBtn) mark(moreBtn, "more"); return {ok:true}; })()`),
  { action: "wait", delay: 1000 },
  ...markThenClick("create-label", `(() => { const createBtn = Array.from(document.querySelectorAll(".aHS-bnq, [role=menuitem]")).find(el => el.textContent?.includes("Create new label")); if (createBtn) { mark(createBtn, "create-label"); return {ok:true}; } return {ok:false,message:"Create new label option not found"}; })()`),
  { action: "wait", delay: 1500 },
  ...markThenType("label-name", `(() => { const input = document.querySelector(".xx input[type=text]") || document.querySelector("[aria-label*=\\"label name\\"] input") || document.querySelector(".Kj-JD-Jl input"); if (input) { mark(input, "label-name"); return {ok:true}; } return {ok:false,message:"Label name input not found"}; })()`, labelName),
  { action: "wait", delay: 500 },
  ...markThenClick("create-ok", `(() => { const btns = document.querySelectorAll("button[name=ok], .Kj-JD-K7-K0 button, button.J-at1-auR"); for (const b of btns) { if (b.textContent?.trim() === "Create" || b.textContent?.trim() === "OK") { mark(b, "create-ok"); return {ok:true}; } } return {ok:false,message:"Create/OK button not found"}; })()`),
  { action: "wait", delay: 2000 },
];

const evalScript = `(() => { return JSON.stringify({ success: true, name: ${labelNameJson}, message: "Label creation attempted via browser session" }); })()`;

(async () => {
  const result = await browserInteract(
    "https://mail.google.com/mail/u/0/#inbox",
    actions,
    undefined,
    evalScript,
  );
  const content = result?.content || "{}";
  const parsed = typeof content === "string" ? JSON.parse(content) : content;
  console.log(JSON.stringify(parsed));
})();
