import {
  errorJson,
  requireBrowserSession,
  browserInteract,
} from "../../_shared/_google_helpers";

const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
const eventId: string = params.eventId || "";
const calendarId: string = params.calendarId || "primary";

if (!eventId) {
  errorJson("MISSING_PARAM", "eventId is required");
}

requireBrowserSession();

const summary: string = params.summary || "";
const description: string = params.description || "";
const location: string = params.location || "";
const start: string = params.start || "";
const end: string = params.end || "";

const eidRaw = `${eventId} ${calendarId}`;
const eidB64 = Buffer.from(eidRaw).toString("base64");
const editUrl = `https://calendar.google.com/calendar/event?action=EDIT&eid=${eidB64}`;

const CLICK_SAVE = `(function(){var btns=document.querySelectorAll("button");for(var i=0;i<btns.length;i++){var t=btns[i].textContent.trim();if(t==="Save"||t==="save"){btns[i].click();return{ok:true,message:"Event updated via browser"}}}var alt=document.querySelector("[aria-label=Save]");if(alt){alt.click();return{ok:true,message:"Event updated via browser"}}return{ok:false,message:"Save button not found"}})()`;
const TITLE_SELECTOR = '[data-key="title"] input, input[aria-label="Title"]';

const pageActions: any[] = [
  { action: "wait", delay: 3000 },
];

if (summary) {
  pageActions.push(
    { action: "click", selector: TITLE_SELECTOR },
    { action: "press", key: "Control+a" },
    { action: "type", text: summary },
  );
}

if (location) {
  pageActions.push(
    { action: "click", selector: 'input[aria-label="Location"], [data-key="location"] input, input[placeholder*="location" i]' },
    { action: "press", key: "Control+a" },
    { action: "type", text: location },
    { action: "wait", delay: 500 },
    { action: "press", key: "Escape" },
  );
}

if (description) {
  pageActions.push(
    { action: "click", selector: '[data-key="description"] [contenteditable="true"], [aria-label="Description"], textarea[aria-label="Description"]' },
    { action: "press", key: "Control+a" },
    { action: "insertText", text: description },
  );
}

pageActions.push(
  { action: "wait", delay: 1000 },
  { action: "evaluate", script: CLICK_SAVE },
  { action: "wait", delay: 2000 },
);

(async () => {
  const result = await browserInteract(editUrl, pageActions);
  const content = result?.content || {};
  const parsed = typeof content === "string" ? JSON.parse(content) : content;
  const opOk = parsed?.ok ?? false;

  if (opOk) {
    console.log(JSON.stringify({ ok: true, eventId, method: "browser" }));
  } else {
    const opMsg = parsed?.message || "unknown error";
    errorJson("BROWSER_ERROR", `Failed to update event via browser: ${opMsg}`);
  }
})();
