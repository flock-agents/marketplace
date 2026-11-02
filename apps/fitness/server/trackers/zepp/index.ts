// The Zepp adapter: daily totals, sleep, workouts, scale readings and PAI through the Zepp connector.
import { PAI_LABEL } from "../../db/constants";
import type { Tracker } from "../types";
import { ZEPP_ID, ZEPP_SKILL_ID } from "./config";
import { syncPass } from "./pass";

export const zepp: Tracker = {
  id: ZEPP_ID,
  name: "Zepp",
  skillId: ZEPP_SKILL_ID,
  metrics: ["Steps", "Calories burned", "Distance", "Sleep", "Deep sleep", "Sleep score", "Resting heart rate", "Weight", "Body fat", PAI_LABEL],
  sync: ({ call, store, now }, days) => syncPass(call, store, now, days),
};
