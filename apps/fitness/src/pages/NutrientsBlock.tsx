import { useState } from "react";
import { Empty, ErrorCard, Section, Table, Tabs } from "../flock/ui";
import type { Nutrient, NutrientGroup } from "../../server/nutrition/catalog";
import type { NutritionReview } from "../../server/nutrition/review";
import { useLive } from "./useLive";

const DAYS = 7;
const TABLES = ["events"] as const;
const GROUPS: NutrientGroup[] = ["Headline", "Macros", "Vitamins", "Minerals"];
type Review = NutritionReview & { nutrients: Nutrient[] };

const amount = (n: number | null) => (n === null ? "–" : n.toLocaleString("en-IN", { maximumFractionDigits: 1 }));

/** Every nutrient of the week's logged meals, a daily average per nutrient: the whole diet, beyond the numbers in focus. */
export function NutrientsBlock() {
  const [group, setGroup] = useState<NutrientGroup>("Macros");
  const { data, error, refetch } = useLive<Review>(`nutrition?days=${DAYS}`, TABLES);
  const rows = (data?.nutrients ?? []).filter((n) => n.group === group).map((n) => ({ id: n.key, ...n, average: data!.average[n.key] }));
  const title = `Nutrients · daily average, last ${DAYS} days`;
  if (error) return <Section title={title}><ErrorCard title="Couldn't load the nutrients" message={error} onRetry={refetch} /></Section>;
  if (data && data.meals === 0) return <Section title={title}><Empty title="No meals logged this week" hint="Every meal's full nutrient estimate adds up here." object="globe" /></Section>;
  return (
    <Section title={title}>
      <Tabs tabs={GROUPS.map((g) => ({ id: g, label: g }))} value={group} onChange={(g) => setGroup(g as NutrientGroup)} />
      <Table density="compact" loading={!data} rows={rows} columns={[
        { key: "label", label: "Nutrient" },
        { key: "average", label: "Per day", align: "end" as const, render: (r: (typeof rows)[number]) => `${amount(r.average)} ${r.unit}` },
      ]} />
      {data ? <p className="db-quiet">From {data.meals} meals; {data.fullBreakdown} carry the full breakdown.</p> : null}
    </Section>
  );
}
