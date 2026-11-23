import { useState } from "react";
import { Bullets, Button, Card, Empty, Gallery, Heading, Icon, Page, Stack, label, safeHref, safeSrc, useApp, useTable } from "../flock/ui";
import { agentName, recipeSourceLabel, textList } from "./format";
import { joined, type RecipeRow } from "./shared";

type Ingredient = { item?: unknown; amount?: unknown; unit?: unknown };
const ingredientText = (i: Ingredient): string => [i.amount, i.unit, i.item].filter((x) => x != null && x !== "").join(" ");
/** A link without its scheme, short enough to read: what the family taps. */
const linkWords = (href: string): string => { const t = href.replace(/^https?:\/\//i, "").replace(/\/$/, ""); return t.length > 60 ? `${t.slice(0, 57)}…` : t; };

/** The family's saved recipes, with their videos. A recipe opens in place, under its card. A link or a picture saved with a
 *  recipe is any text someone sent: only a safe link is linked, and only a safe picture is loaded. */
export function RecipesPage() {
  const list = useTable<RecipeRow>("saved_recipes", { sort: "name", limit: 100 });
  const [openId, setOpenId] = useState<string | null>(null);
  const picked = openId ? list.rows.find((r) => r.id === openId) : undefined;
  const agent = agentName(useApp().display);
  return (
    <Page title={label("title.recipes", "Recipes")} subtitle={`Share a reel to ${agent} on WhatsApp and say "save this"`}>
      <Gallery
        rows={list.rows} loading={list.loading} error={list.error} hasMore={list.hasMore} onLoadMore={list.loadMore}
        image={(r) => safeSrc(r.thumbnail)} object={() => "grocery-bag"} columns={2}
        title={(r) => r.name}
        meta={(r) => [recipeSourceLabel(r), ...textList(r.tags)].join(" · ")}
        onClick={(r) => setOpenId(openId === r.id ? null : r.id)}
        empty={<Empty title="No recipes saved yet" hint={`Saved recipes show here, and ${agent} can plan them into a week.`} object="grocery-bag" />}
        expanded={picked ? { at: picked.id, label: picked.name, onClose: () => setOpenId(null), content: <RecipeDetail recipe={picked} agent={agent} onClose={() => setOpenId(null)} /> } : null}
      />
    </Page>
  );
}

function RecipeDetail({ recipe: r, agent, onClose }: { recipe: RecipeRow; agent: string; onClose: () => void }) {
  const links = textList<unknown>(r.links).filter((l): l is string => typeof l === "string" && !!l.trim());
  const ingredients = textList<Ingredient>(r.ingredients).map(ingredientText).filter(Boolean);
  const who = joined(textList(r.for_people));
  return (
    <Card title={r.name} meta={[recipeSourceLabel(r), who ? `for ${who}` : null, ...textList(r.tags)].filter(Boolean).join(" · ")}
      actions={<Button size="sm" variant="ghost" icon="x" onClick={onClose}>Close</Button>}>
      <Stack gap="md">
        {links.length ? (
          <Stack gap="xs">
            {links.map((l, i) => {
              const href = safeHref(l);
              return href
                ? <a key={i} className="pl-chip" href={href} target="_blank" rel="noopener noreferrer"><Icon name="play" size={12} />{linkWords(href)}</a>
                : <span key={i} className="pl-quiet">{l}</span>;
            })}
          </Stack>
        ) : <p className="pl-quiet">No link saved with this recipe.</p>}
        <Stack gap="xs">
          <Heading level={3}>Ingredients</Heading>
          {ingredients.length ? <Bullets items={ingredients} /> : <p className="pl-quiet">{`None saved yet. Ask ${agent} to add them.`}</p>}
        </Stack>
        {r.notes ? <Stack gap="xs"><Heading level={3}>Notes</Heading><p className="pl-notes">{r.notes}</p></Stack> : null}
      </Stack>
    </Card>
  );
}
