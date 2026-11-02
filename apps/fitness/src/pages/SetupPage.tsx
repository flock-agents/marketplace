import { useState } from "react";
import { Card, Form, Page, kitFetch } from "../flock/ui";
import { PERSON_SETTING, TIMEZONE_SETTING } from "../../server/profile/keys";

/** The browser's own zone, offered first; every zone the browser knows is a suggestion. */
const ownZone = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""; } catch { return ""; } };
const zones = (): string[] => { try { return Intl.supportedValuesOf("timeZone"); } catch { return []; } };

const FIELDS = [
  { type: "text", name: PERSON_SETTING, label: "Who this dashboard is for (name)", required: true },
  { type: "text", name: TIMEZONE_SETTING, label: "Their time zone (e.g. Europe/London)", required: true, options: zones() },
] as const;

/** Shown until the app knows who it is for: until then nothing runs (no tracker sync, no plans or summaries from the coach). */
export function SetupPage() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async (values: Record<string, unknown>) => {
    setErrors({});
    try { await kitFetch("_app/settings", { method: "PATCH", body: JSON.stringify(values) }); }   // the page follows the setting change
    catch (e) { setErrors({ [TIMEZONE_SETTING]: e instanceof Error ? e.message : String(e) }); }
  };
  return (
    <Page>
      <Card title="Who is this dashboard for?">
        <p>Until you say, the dashboard stays quiet: no tracker sync, and no plans or summaries from the coach.</p>
        <Form fields={[...FIELDS]} initial={{ [PERSON_SETTING]: "", [TIMEZONE_SETTING]: ownZone() }} submitLabel="Start" errors={errors} onSubmit={save} />
      </Card>
    </Page>
  );
}
