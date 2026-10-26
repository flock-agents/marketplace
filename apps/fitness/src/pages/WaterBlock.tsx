import { useState } from "react";
import { Icon, useTable } from "../flock/ui";
import { GLASS_ML } from "../../server/db/constants";
import type { GoalLine } from "../../server/today/goals";
import { GoalRow } from "./GoalRow";
import { localDate, shiftDay, todayLocal } from "./shared";

interface WaterLog { id: string; at: string; ml: number }
/** A glass logged on an earlier day is filed in the evening of that day. */
const LATE_GLASS = "T20:00";
const nowLocal = () => { const t = new Date(); return `${todayLocal()}T${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`; };

/** The day's water against its target, and one glass per tap: tap the next empty glass to log one, the last full one to take it back. */
export function WaterBlock({ day, line }: { day: string; line: GoalLine }) {
  const logs = useTable<WaterLog>("water_logs", { where: { "at[gte]": shiftDay(day, -1), "at[lt]": shiftDay(day, 2) }, sort: "at", limit: 100 });
  const [busy, setBusy] = useState(false);
  const mine = logs.rows.filter((w) => localDate(w.at) === day);
  const full = Math.floor(mine.reduce((a, w) => a + w.ml, 0) / GLASS_ML);
  const goal = Math.ceil(((line.target ?? 0) * 1000) / GLASS_ML);
  const glasses = Math.max(goal, full + 1);   // past the target there is always one more glass to tap
  const act = async (fill: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (fill) await logs.create({ at: day === todayLocal() ? nowLocal() : `${day}${LATE_GLASS}`, ml: GLASS_ML });
      else if (mine.length) await logs.remove(mine[mine.length - 1].id);
    } finally { setBusy(false); }
  };
  return (
    <div className="db-water">
      <GoalRow line={line} />
      <div className="db-glasses" role="group" aria-label={`Water, ${GLASS_ML} ml a glass`}>
        {Array.from({ length: glasses }, (_, i) => {
          const isFull = i < full;
          const tappable = i === full || i === full - 1;
          return (
            <button key={i} type="button" className={isFull ? "db-glass is-full" : "db-glass"} disabled={busy || !tappable}
              aria-label={isFull ? `Take back glass ${i + 1}` : `Log glass ${i + 1}`} onClick={() => void act(!isFull)}>
              <Icon name="glass-water" size={22} />
            </button>
          );
        })}
      </div>
      <p className="db-quiet">One tap logs a glass of {GLASS_ML} ml.</p>
    </div>
  );
}
