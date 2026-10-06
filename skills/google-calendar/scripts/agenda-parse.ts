// Aria-label parser for Google Calendar agenda rows. The in-page script cannot
// import, so the parser lives here as ES5 source (AGENDA_PARSE_JS) that is
// spliced into the page script in listEvents.ts / listEvents.sh, and the exported
// function is built from that same source. No backslashes, single quotes or
// template syntax in it, so it embeds verbatim in both twins.
export const AGENDA_PARSE_JS = `function parseAgendaAriaLabel(label, textContent) {
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
}`;

export interface ParsedAgendaLabel {
  title: string;
  time: string;
  date: string;
  /** MM-DD when the label carries no year; the app decides the year. */
  monthDay?: string;
  allDay: boolean;
  location: string | null;
  calendar: string | null;
  attendees: string | null;
}

export const parseAgendaAriaLabel: (label: string, textContent: string) => ParsedAgendaLabel =
  new Function(`${AGENDA_PARSE_JS}; return parseAgendaAriaLabel;`)();
