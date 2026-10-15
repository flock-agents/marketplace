#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/_google_helpers.sh"

PARAMS="${SKILL_PARAMS:-"{}"}"
CALENDAR_ID=$(echo "$PARAMS" | jq -r '.calendarId // "primary"')
TIME_MIN=$(echo "$PARAMS" | jq -r '.timeMin // ""')
TIME_MAX=$(echo "$PARAMS" | jq -r '.timeMax // ""')
MAX_RESULTS=$(echo "$PARAMS" | jq -r '.maxResults // 25')

_require_browser_session

AGENDA_URL="https://calendar.google.com/calendar/r/agenda"
if [ -n "$TIME_MIN" ]; then
  DATE_PART=$(echo "$TIME_MIN" | sed 's/T.*//' | tr -d '-')
  if [[ "$DATE_PART" =~ ^[0-9]{8}$ ]]; then
    Y="${DATE_PART:0:4}"
    M="${DATE_PART:4:2}"
    D="${DATE_PART:6:2}"
    AGENDA_URL="https://calendar.google.com/calendar/r/agenda/${Y}/${M}/${D}"
  fi
fi

# Keep in sync with listEvents.ts (AGENDA_PARSE_JS in agenda-parse.ts is the parser source).
EXTRACT_EVENTS='(function(){
  var events = [];
  var seen = {};
  var maxR = '$MAX_RESULTS';
  function parseAgendaAriaLabel(label, textContent) {
  var segs = String(label || "").split(", ");
  var time = segs[0] || "";
  var allDay = /^all day$/i.test(time);
  time = allDay ? "" : time.replace(" to ", " – ");
  var rest = segs.slice(1);
  // The date is the tail of the label, in either order (4 October 2026 or October 4, 2026), as a
  // single day or a range (the start wins). It may span a comma, so it is matched on the joined
  // tail and cut off before location and attendees are read.
  var months = "January February March April May June July August September October November December".split(" ");
  var M = "(?:" + months.join("|") + ")";
  var D = "[0-9]{1,2}";
  var Y = "[0-9]{4}";
  var S = "(?: ?[–-] ?| to )";
  var dateRe = new RegExp("(^|, )(" +
    M + " " + D + "(?:" + S + "(?:" + M + " )?" + D + ")?(?:, " + Y + ")?" + "|" +
    D + " " + M + S + D + " " + M + "(?: " + Y + ")?" + "|" +
    D + S + D + " " + M + "(?: " + Y + ")?" + "|" +
    D + " " + M + "(?: " + Y + ")?" + ")$");
  var tail = rest.join(", ");
  var dm = dateRe.exec(tail);
  var date = "";
  var monthDay;
  if (dm) {
    var toks = dm[2].replace(/[,–-]/g, " ").split(" ").filter(function(t) { return t && t !== "to"; });
    var monthToks = toks.filter(function(t) { return months.indexOf(t) >= 0; });
    var year = 0;
    var nums = [];
    toks.forEach(function(t) {
      if (/^[0-9]{4}$/.test(t)) year = parseInt(t, 10);
      else if (/^[0-9]{1,2}$/.test(t)) nums.push(t);
    });
    var monthFirst = months.indexOf(toks[0]) >= 0;
    var startMonth = monthFirst ? toks[0] : (months.indexOf(toks[1]) >= 0 ? toks[1] : monthToks[monthToks.length - 1]);
    var startDay = parseInt(nums[0], 10);
    var mi = months.indexOf(startMonth);
    if (year) {
      if (months.indexOf(monthToks[monthToks.length - 1]) < mi) year -= 1;
      date = startDay + " " + startMonth + " " + year;
    } else {
      monthDay = (mi < 9 ? "0" : "") + (mi + 1) + "-" + (startDay < 10 ? "0" : "") + startDay;
    }
    var cut = tail.length - dm[2].length - dm[1].length;
    rest = tail.slice(0, cut).split(", ");
    if (cut === 0) rest = [];
  } else if (rest.length > 0 && /^[0-9]{1,2} [^ ]+ [0-9]{4}$/.test(rest[rest.length - 1])) {
    // An unknown-language month: the segment is still a date, never a location.
    rest = rest.slice(0, rest.length - 1);
  }
  var calendar = null;
  for (var c = 0; c < rest.length; c++) {
    if (rest[c].indexOf("Calendar: ") === 0) { calendar = rest[c].slice(10); rest.splice(c, 1); break; }
  }
  // Anchor the title first: textContent is the title, so it equals the join of a prefix of rest.
  var tc = String(textContent || "").replace(/ +/g, " ").trim();
  var n = 1;
  if (tc) {
    for (var k = 1; k <= rest.length; k++) {
      if (rest.slice(0, k).join(", ") === tc) { n = k; break; }
    }
  }
  var title = rest.slice(0, n).join(", ") || tc;
  // The owner's RSVP sits after the organiser; it is never a location (live 2026-10-06: "Accepted").
  var RSVP = ["Accepted", "Declined", "Tentative", "Maybe", "Awaiting", "Needs action", "Not responded"];
  var after = rest.slice(n).filter(function(s) { return s !== "No location" && RSVP.indexOf(s) < 0; });
  // A segment labelled Location: owns every segment after it (the address has commas).
  // Unlabelled: only when two or more segments follow the title, so a lone organiser is never
  // taken for a location. We prefer losing a location over inventing one.
  var location = null;
  var li = -1;
  for (var q = 0; q < after.length; q++) {
    if (after[q].indexOf("Location: ") === 0) { li = q; break; }
  }
  if (li >= 0) {
    location = after.slice(li).join(", ").slice(10);
    after = after.slice(0, li);
  } else if (after.length >= 2) location = after.pop();
  var out = { title: title, time: time, date: date, allDay: allDay, location: location, calendar: calendar, attendees: after.length ? after.join(", ") : null };
  if (monthDay) out.monthDay = monthDay;
  return out;
}
  var btns = document.querySelectorAll("div[role=\"button\"][data-eventid][aria-label]");
  Array.prototype.forEach.call(btns, function(b) {
    if (events.length >= maxR) return;
    var eventId = b.getAttribute("data-eventid") || "";
    if (!eventId || seen[eventId]) return;
    seen[eventId] = true;
    var p = parseAgendaAriaLabel(b.getAttribute("aria-label"), b.textContent);
    if (!p.title) return;
    events.push({eventId: eventId, title: p.title, time: p.time, date: p.date, allDay: p.allDay, location: p.location, calendar: p.calendar, attendees: p.attendees, monthDay: p.monthDay});
  });
  if (events.length > 0) {
    return JSON.stringify({ok: true, events: events, count: events.length});
  }

  // Fallback: no aria-label button rows on the page; use the older span-based reading.
  var rows = document.querySelectorAll("[data-eventid]");
  if (rows.length === 0) {
    rows = document.querySelectorAll("[data-eventchip]");
  }
  if (rows.length === 0) {
    rows = document.querySelectorAll("[role=\"listitem\"], [role=\"button\"][data-eventid], li[data-datekey]");
  }
  var dateHeaders = document.querySelectorAll("h2, [data-datekey], .K3Gpe");
  var dateMap = {};
  dateHeaders.forEach(function(h){
    var txt = h.textContent.trim();
    if (/\w+,\s|\d{1,2}\s\w+|\w+\s\d{1,2}/.test(txt)) dateMap[h.offsetTop] = txt;
  });
  var dateTops = Object.keys(dateMap).map(Number).sort(function(a,b){return a-b;});

  function getDateForY(y) {
    var best = "";
    for (var i = 0; i < dateTops.length; i++) {
      if (dateTops[i] <= y) best = dateMap[dateTops[i]];
      else break;
    }
    return best;
  }

  rows.forEach(function(row) {
    if (events.length >= maxR) return;
    var title = "";
    var time = "";
    var eventId = row.getAttribute("data-eventid") || "";
    if (eventId && seen[eventId]) return;

    var titleEl = row.querySelector("[data-key=\"title\"]") || row.querySelector("span[aria-hidden=\"true\"]") || row.querySelector("span");
    if (titleEl) title = titleEl.textContent.trim();

    var timeEl = row.querySelector("[data-key=\"when\"]") || row.querySelector("span[data-datekey]");
    if (timeEl) time = timeEl.textContent.trim();
    if (!time) {
      var cell = row.querySelector("div[role=\"gridcell\"]");
      if (cell) time = cell.textContent.trim();
    }
    if (!time) {
      var spans = row.querySelectorAll("span");
      for (var j = 0; j < spans.length; j++) {
        var t = spans[j].textContent.trim();
        if (/\d{1,2}[:\s]?\d{2}/.test(t) || /all.day/i.test(t)) { time = t; break; }
      }
    }

    var date = getDateForY(row.offsetTop);
    if (title) { if (eventId) seen[eventId] = true; events.push({eventId: eventId, title: title, time: time, date: date, allDay: false, location: null, calendar: null, attendees: null}); }
  });

  return JSON.stringify({ok: true, events: events, count: events.length});
})()'

PAGE_ACTIONS=$(jq -nc --arg script "$EXTRACT_EVENTS" '[
  {action: "wait", delay: 3000},
  {action: "evaluate", script: $script}
]')

RESULT=$(_browser_interact "$AGENDA_URL" "$PAGE_ACTIONS")
CONTENT=$(echo "$RESULT" | jq -r '.content // "{}"')
PARSED=$(echo "$CONTENT" | jq -c '.' 2>/dev/null || echo '{}')
LIST_OK=$(echo "$PARSED" | jq -r '.ok // false')

if [ "$LIST_OK" = "true" ]; then
  echo "$PARSED" | jq -c '. + {source: "browser_session"}'
else
  _error_json "BROWSER_ERROR" "Failed to extract events from calendar agenda view"
fi
