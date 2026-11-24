import {
  errorJson,
  requireBrowserSession,
  browserInteract,
  urlencode,
} from "../../_shared/_google_helpers";
import { saveEventActions } from "./save-button";

const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
const summary: string = params.summary || "";
const start: string = params.start || "";
const end: string = params.end || "";
const description: string = params.description || "";
const location: string = params.location || "";
const calendarId: string = params.calendarId || "primary";

if (!summary || !start || !end) {
  errorJson("MISSING_PARAM", "summary, start, and end are required");
}

requireBrowserSession();

function formatGcalTime(input: string): string {
  if (input.endsWith("Z")) {
    return input.replace(/[-:]/g, "");
  }
  if (/\+\d{2}:\d{2}$/.test(input) || /-\d{2}:\d{2}$/.test(input)) {
    return input.replace(/[-:]/g, "").replace(/[+-]\d{4}$/, "");
  }
  return input.replace(/[-:]/g, "");
}

const urlStart = formatGcalTime(start);
const urlEnd = formatGcalTime(end);

let editUrl = `https://calendar.google.com/calendar/r/eventedit?text=${urlencode(summary)}&dates=${urlStart}/${urlEnd}`;
if (description) editUrl += `&details=${urlencode(description)}`;
if (location) editUrl += `&location=${urlencode(location)}`;

const pageActions = [
  { action: "wait", delay: 3000 },
  ...saveEventActions("Event created via browser"),
  { action: "wait", delay: 2000 },
];

(async () => {
  const result = await browserInteract(editUrl, pageActions);
  const content = result?.content || {};
  const parsed = typeof content === "string" ? JSON.parse(content) : content;
  const saveOk = parsed?.ok ?? false;

  if (saveOk) {
    console.log(JSON.stringify({
      ok: true,
      summary,
      start,
      end,
      source: "browser_session",
    }));
  } else {
    const saveMsg = parsed?.message || "unknown error";
    errorJson("BROWSER_ERROR", `Failed to create event via browser: ${saveMsg}`);
  }
})();
