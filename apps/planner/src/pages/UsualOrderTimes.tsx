// "Usual ordering times": the order windows the app learned from past orders (or the owner pinned), collapsed by
// default. Pinning keeps a time no matter what history says; unpinning hands it back to learning.
import { useEffect, useState } from "react";
import { Button, useToast } from "../flock/ui";
import { togglePin, windowLabel, type OrderWindow } from "./shopping";
import { orderPatterns, setPinnedWindows } from "./shoppingApi";

export function UsualOrderTimes({ onChanged }: { onChanged?: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [windows, setWindows] = useState<OrderWindow[] | null>(null);
  useEffect(() => { if (open && !windows) void orderPatterns().then((p) => setWindows(p.windows)).catch(() => setWindows([])); }, [open, windows]);

  const toggle = async (w: OrderWindow) => {
    try { setWindows((await setPinnedWindows(togglePin(windows ?? [], w))).windows); onChanged?.(); }
    catch { toast.show({ message: "Couldn't change that ordering time", tone: "danger" }); }
  };

  return (
    <div className="pl-usual">
      <button type="button" className="pl-past" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide" : "Show"} usual ordering times
      </button>
      {open ? (
        windows === null ? <p className="pl-usual-note">Loading…</p>
          : windows.length === 0 ? <p className="pl-usual-note">Not enough orders yet to learn a usual time — orders follow your settings for now.</p>
          : (
            <ul className="pl-usual-list">
              {windows.map((w) => (
                <li key={`${w.source}:${w.days.join()}:${w.from}`}>
                  <span>{windowLabel(w)}</span>
                  <Button variant="soft" onClick={() => void toggle(w)}>{w.source === "pinned" ? "Unpin" : "Pin"}</Button>
                </li>
              ))}
            </ul>
          )
      ) : null}
    </div>
  );
}
