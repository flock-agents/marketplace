import "./detail.css";
import type { ToneT } from "../../tone";
import { Value, type ValueKind } from "../Value/Value";
import { SampleChip } from "../Sample/Sample";
export interface DetailField { label: string; value: unknown; kind?: ValueKind; tones?: Record<string, ToneT>; labels?: Record<string, string> }
export interface DetailProps {
  fields: DetailField[];
  /** The record is a sample (its `_sample`): the values are lighter and a Sample chip heads the list. */
  sample?: boolean;
}
export function Detail({ fields, sample }: DetailProps) {
  return (
    <>
      {sample ? <p className="fl-detail-sample"><SampleChip /><span>A sample row, to show how the app works. Edit it to keep it.</span></p> : null}
      <dl className="fl-detail">
        {fields.map((f, i) => (
          <div className="fl-detail-row" key={`${f.label}-${i}`}>
            <dt>{f.label}</dt>
            <dd className={sample ? "fl-sample-fade" : undefined}><Value kind={f.kind ?? "text"} value={f.value} tones={f.tones} labels={f.labels} /></dd>
          </div>
        ))}
      </dl>
    </>
  );
}
