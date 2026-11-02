// The app is idle until the family has told the agent about themselves (server/setupGate.ts): say so on every page, with
// what to do about it, so a quiet app never reads as a broken one.
import { Callout } from "../flock/ui";

/** The same rule as the server's householdKnown: the household.profile setting holds the family's answers. */
export function householdKnownFrom(settings: Record<string, unknown>): boolean {
  const v = settings["household.profile"];
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0;
}

export function IdleNotice({ settings, loading }: { settings: Record<string, unknown>; loading: boolean }) {
  if (loading || householdKnownFrom(settings)) return null;
  return (
    <Callout tone="info" icon="pause" title="Waiting to hear about your household">
      Nothing is planned or bought yet, and what you see here are samples. Tell the agent in chat who eats, your food
      habits, which meals to plan and where you shop, and the planner starts from that.
    </Callout>
  );
}
