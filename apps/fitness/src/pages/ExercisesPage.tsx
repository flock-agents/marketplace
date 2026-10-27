import { useEffect, useState } from "react";
import { Button, Page, kitFetch, useApp, useTable } from "../flock/ui";
import { EXERCISES, imagePath } from "../../server/exercises/library";
import { EXERCISES_NOTE_SETTING } from "../../server/profile/keys";
import { mediaPath, type AddedExercise } from "../../server/exercises/plan";
import { useDelete } from "./useDelete";

type AddedRow = AddedExercise & { id: string; gif_url: string | null };

/** The exercise a link points at: "#/exercises?ex=goblet-squat". */
const pointedAt = () => new URLSearchParams(location.hash.split("?")[1] ?? "").get("ex");

/** Every exercise the coach programs, with how it moves and the cues. Opened from the Today page. */
export function ExercisesPage() {
  const note = useApp().settings[EXERCISES_NOTE_SETTING];
  // The exercises the coach added: data, not code. Removing one also removes its downloaded picture.
  const added = useTable<AddedRow>("exercises", { sort: "added_at", limit: 500 });
  const del = useDelete<AddedRow>(async (id) => {
    const row = added.rows.find((r) => r.id === id);
    if (row) await kitFetch(`exercises/${encodeURIComponent(row.slug)}`, { method: "DELETE" });
    return undefined;
  }, "exercise", (r) => r.name);
  const [focus, setFocus] = useState(pointedAt);
  useEffect(() => {
    const on = () => setFocus(pointedAt());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => { if (focus) document.getElementById(`ex-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [focus]);
  return (
    <Page title="Exercises" subtitle={typeof note === "string" && note ? note : undefined} actions={<Button variant="soft" size="sm" icon="arrow-left" onClick={() => { location.hash = "#/today"; }}>Back to Today</Button>}>
      <div className="db-exercises">
        {EXERCISES.map((e) => (
          <article key={e.slug} id={`ex-${e.slug}`} className={e.slug === focus ? "db-exercise is-focus" : "db-exercise"}>
            <img src={imagePath(e.slug)} alt={`${e.name}, shown moving`} loading="lazy" />
            <div className="db-exercise-body">
              <h3>{e.name}</h3>
              <ul>{e.cues.map((c) => <li key={c}>{c}</li>)}</ul>
              <p className="db-exercise-back">{e.back}</p>
              <p className="db-exercise-credit">Picture: {e.credit}</p>
            </div>
          </article>
        ))}
        {added.rows.map((e) => (
          <article key={e.id} id={`ex-${e.slug}`} className={e.slug === focus ? "db-exercise is-focus" : "db-exercise"}>
            {e.file ? <img src={mediaPath(e.file)} alt={`${e.name}, shown moving`} loading="lazy" /> : <div className="db-exercise-nopic" />}
            <div className="db-exercise-body">
              <h3>{e.name}</h3>
              {e.notes ? <p>{e.notes}</p> : null}
              {e.gif_url ? <p className="db-exercise-credit">Picture: {new URL(e.gif_url).hostname}</p> : null}
              <Button variant="soft" size="sm" icon="trash-2" onClick={() => del.ask(e)}>Remove</Button>
            </div>
          </article>
        ))}
      </div>
      {del.dialog}
    </Page>
  );
}
