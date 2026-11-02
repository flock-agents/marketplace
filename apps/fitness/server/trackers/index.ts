// Every tracker adapter the app knows. Add one: server/trackers/<id>/index.ts exporting a Tracker, listed here, and its
// connector in flock.app.json config.requires.skills as optional.
import type { Tracker } from "./types";
import { zepp } from "./zepp";

export const TRACKERS: readonly Tracker[] = [zepp];

