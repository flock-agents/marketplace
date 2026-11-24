// Saved recipes: a name, its video links, where they are from and a thumbnail, as the agent saves them (save_recipe).
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";

const REEL = "https://www.instagram.com/reel/abc123/";

describe("save_recipe", () => {
  it("save_recipe dedupes by link and needs a name for a new one", async () => {
    const { op, rows } = await boot();
    const first = await op("save_recipe", { name: "Dal makhani", links: [REEL], tags: ["Saturday fun dinner"] });
    expect(first.recipe).toMatchObject({ name: "Dal makhani", links: [REEL], source: "instagram", thumbnail: null, tags: ["Saturday fun dinner"] });
    // The same reel shared again, with the share's own tracking on the link: the recipe is updated, not saved twice.
    const again = await op("save_recipe", { links: ["https://instagram.com/reel/abc123?igsh=xyz"], notes: "less butter" });
    expect(again.recipe.id).toBe(first.recipe.id);
    expect(again.recipe).toMatchObject({ name: "Dal makhani", notes: "less butter", links: [REEL], tags: ["Saturday fun dinner"] });
    expect(rows("saved_recipes")).toHaveLength(1);

    const unnamed = await op("save_recipe", { links: ["https://www.instagram.com/reel/other"] });
    expect(unnamed).toMatchObject({ code: "NEEDS_NAME", status: 400 });
    expect(rows("saved_recipes")).toHaveLength(1);

  });

  it("takes the source from the first link and the thumbnail from a YouTube one", async () => {
    const { op, rows } = await boot();
    const { recipe } = await op("save_recipe", { name: "Paneer butter masala", links: ["https://youtube.com/shorts/XyZ_123", REEL],
      notes: "Dad likes it mild", ingredients: [{ item: "paneer", amount: 200, unit: "g" }, { item: "butter" }], for: ["Dad"] });
    expect(recipe).toMatchObject({ source: "youtube", thumbnail: "https://i.ytimg.com/vi/XyZ_123/hqdefault.jpg", notes: "Dad likes it mild",
      ingredients: [{ item: "paneer", amount: 200, unit: "g" }, { item: "butter", amount: null, unit: null }], tags: [], for_people: ["Dad"] });
    expect(rows("saved_recipes")[0].updated_by).toBe("agent:meal-agent");
    // The same video by its other address is the same recipe.
    const watch = await op("save_recipe", { links: ["https://www.youtube.com/watch?v=XyZ_123&t=4s"], tags: ["dinner"] });
    expect(watch.recipe.id).toBe(recipe.id);
    expect(watch.recipe.links).toEqual(["https://youtube.com/shorts/XyZ_123", REEL]);
    const own = await op("save_recipe", { name: "Poha", links: ["https://www.hebbarskitchen.com/poha"], thumbnail: "https://img.example/poha.jpg" });
    expect(own.recipe).toMatchObject({ source: "other", thumbnail: "https://img.example/poha.jpg" });
    expect((await op("save_recipe", { name: "Curd rice" })).recipe).toMatchObject({ links: [], source: null, thumbnail: null });
  });

  it("a link not saved before is added to the recipe it was found by", async () => {
    const { op } = await boot();
    const { recipe } = await op("save_recipe", { name: "Dal makhani", links: [REEL] });
    const more = await op("save_recipe", { links: [REEL, "https://youtu.be/d4lM4khani"] });
    expect(more.recipe.id).toBe(recipe.id);
    expect(more.recipe.links).toEqual([REEL, "https://youtu.be/d4lM4khani"]);
    // The first link still says where it is from; the thumbnail it did not have comes from the YouTube link.
    expect(more.recipe).toMatchObject({ source: "instagram", thumbnail: "https://i.ytimg.com/vi/d4lM4khani/hqdefault.jpg" });
  });

  it("by recipe_id only what is sent changes, and links sent replace the recipe's", async () => {
    const { op, rows } = await boot();
    const { recipe } = await op("save_recipe", { name: "Dal makhani", links: [REEL], notes: "less butter", tags: ["dinner"] });
    const renamed = await op("save_recipe", { recipe_id: recipe.id, name: "Dal makhani (Dad's)" });
    expect(renamed.recipe).toMatchObject({ id: recipe.id, name: "Dal makhani (Dad's)", links: [REEL], notes: "less butter", tags: ["dinner"] });
    const relinked = await op("save_recipe", { recipe_id: recipe.id, links: ["https://youtu.be/d4lM4khani"], notes: null });
    expect(relinked.recipe).toMatchObject({ links: ["https://youtu.be/d4lM4khani"], source: "youtube", notes: null,
      thumbnail: "https://i.ytimg.com/vi/d4lM4khani/hqdefault.jpg" });
    expect(rows("saved_recipes")).toHaveLength(1);
    expect(await op("save_recipe", { recipe_id: "nope", name: "X" })).toMatchObject({ code: "APP_REFUSED", status: 404 });
  });

  it("a thumbnail the family gave is kept when the links change", async () => {
    const { op } = await boot();
    const { recipe } = await op("save_recipe", { name: "Poha", links: [REEL], thumbnail: "https://img.example/poha.jpg" });
    const more = await op("save_recipe", { recipe_id: recipe.id, links: ["https://youtu.be/p0ha"] });
    expect(more.recipe.thumbnail).toBe("https://img.example/poha.jpg");
  });

  it("refuses what it cannot keep; the owner's page saves through the same route", async () => {
    const { op, owner, rows } = await boot();
    expect(await op("save_recipe", { name: "X", links: "https://youtu.be/a" })).toMatchObject({ code: "APP_REFUSED", status: 400 });
    expect(await op("save_recipe", { name: "X", links: ["  "] })).toMatchObject({ code: "APP_REFUSED" });
    expect(await op("save_recipe", { name: "X", for: ["everyone"], ingredients: [{ amount: 2 }] })).toMatchObject({ code: "APP_REFUSED" });
    expect(await op("save_recipe", { name: "X", for: ["everyone"], ingredients: [{ item: "paneer", amount: "200 g" }] })).toMatchObject({ code: "APP_REFUSED" });
    expect(await op("save_recipe", { name: "X", tags: "dinner" })).toMatchObject({ code: "APP_REFUSED" });
    expect(await op("save_recipe", { name: "  ", links: [REEL] })).toMatchObject({ code: "NEEDS_NAME" });
    expect(rows("saved_recipes")).toHaveLength(0);
    // The owner's page saves through the same route, and the refusal carries its code there too.
    const refused = await owner("POST", "/api/recipes/save", { links: [REEL] });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ ok: false, code: "NEEDS_NAME" });
    const saved = await owner("POST", "/api/recipes/save", { name: "Poha", links: [REEL] });
    expect(saved.body.recipe.name).toBe("Poha");
    expect(rows("saved_recipes")[0].updated_by).toBe("user:tester");
  });
});
