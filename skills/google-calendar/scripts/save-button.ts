import { MARK_JS, clickTarget } from "../../_shared/_realInput";

/** The event editor's Save button, pressed with real input: a page script finds and marks it
 *  (its result, `{ok, message}`, is the run's content), then Flock clicks the mark when there is one. */
export function saveEventActions(savedMessage: string): any[] {
  const markSave = `(function(){
  ${MARK_JS}
  var save = null;
  var btns = document.querySelectorAll("button");
  for (var i = 0; i < btns.length && !save; i++) {
    var t = btns[i].textContent.trim();
    if (t === "Save" || t === "save") save = btns[i];
  }
  if (!save) save = document.querySelector("[aria-label=Save]");
  if (!flockMark("save", save)) return {ok:false, message:"Save button not found"};
  return {ok:true, message:${JSON.stringify(savedMessage)}};
})()`;
  return [
    { action: "evaluate", script: markSave },
    clickTarget("save", true),
  ];
}
