import "./sample.css";

/** True for a row the kit seeded as a sample (`_sample: true` on `/api/_data` reads). */
export function isSample(row: unknown): boolean {
  return !!row && typeof row === "object" && (row as { _sample?: unknown })._sample === true;
}
/** The class that lightens a sample row's content, or undefined for a real row. */
export const sampleFade = (sample: boolean): string | undefined => (sample ? "fl-sample-fade" : undefined);
/** The small "Sample" chip shown on a sample row. */
export function SampleChip() {
  return <span className="fl-sample-chip">Sample</span>;
}
/** What the sample fade never covers: anything a viewer operates. sample.css repeats this list (a test keeps them equal). */
export const CONTROL = "button, a[href], input, select, textarea, [role=button], [role=checkbox], [role=menuitem], [tabindex]";
/** The class for template-supplied content that may hold a control: faded only when it neither is nor holds one. */
export const sampleSoft = (sample: boolean): string | undefined => (sample ? "fl-sample-soft" : undefined);
