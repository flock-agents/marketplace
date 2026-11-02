// Until the app knows who it is for (name and time zone) it does nothing: no tracker sync, no coach wakes. The page asks the
// owner for both first. The browser pages share this, so it imports only the setting keys.
import { PERSON_SETTING, TIMEZONE_SETTING } from "./keys";

export const SETUP_SETTINGS = [PERSON_SETTING, TIMEZONE_SETTING] as const;

/** Every setting the app needs before it runs anything is filled in. */
export const isSetUp = (get: (key: string) => unknown): boolean =>
  SETUP_SETTINGS.every((key) => { const value = get(key); return typeof value === "string" && value.trim() !== ""; });
