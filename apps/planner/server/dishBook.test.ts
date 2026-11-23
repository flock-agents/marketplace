// The dish book: a dish's video and how it went, kept by its name across weeks (set_dish_video, rate_dishes, get_dish), and
// where both show up: the week the Week page reads, the context a plan starts from, the reminder's and the Sunday's text, and
// the evening's one question about today's food. Today is Monday 23 Nov 2026, 19:00.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { REMINDER_PROMPT } from "./routines/reminders";
import { WEEKLY_PROMPT } from "./routines/weekly-plan";

const MON = "2026-11-23", TUE = "2026-11-24", NEXT_MON = "2026-11-30";
const RAJMA_VIDEO = "https://www.youtube.com/watch?v=abc123XYZ";
const REEL = "https://www.instagram.com/reel/Cxyz123/";

const dish = (name: string, item = name) => ({ name, for: ["everyone"], ingredients: [{ item, amount: 200, unit: "g" }] });
const meal = (date: string, slot: string, ...names: string[]) => ({ date, slot, dishes: names.map((n) => dish(n)) });

const start = async (hour = 19, day = 23) => {
  const k = await boot({ now: () => new Date(2026, 10, day, hour) });
  return k;
};
const weekOf = async (k: Awaited<ReturnType<typeof start>>, monday: string) => (await k.owner("GET", `/api/weeks/${monday}`)).body;
const dishIn = (week: any, date: string, slot: string, name: string) =>
  week.days.find((d: any) => d.date === date).meals.find((m: any) => m.slot === slot).dishes.find((d: any) => d.name === name);

describe("a dish's video", () => {
  it("belongs to the dish: attached once, it shows every week the dish is planned, with no call again", async () => {
    const k = await start();
    await k.op("plan_week", { week_start: MON, mode: "final", meals: [meal(MON, "Lunch", "Rajma chawal")] });
    const r = await k.op("set_dish_video", { dish: "rajma chawal", url: RAJMA_VIDEO, title: "Punjabi rajma" });
    expect(r.dish).toMatchObject({ name: "Rajma chawal", video: { url: RAJMA_VIDEO, title: "Punjabi rajma", thumbnail: "https://i.ytimg.com/vi/abc123XYZ/hqdefault.jpg" } });
    expect(dishIn(await weekOf(k, MON), MON, "Lunch", "Rajma chawal").video).toEqual({ url: RAJMA_VIDEO, title: "Punjabi rajma", thumbnail: "https://i.ytimg.com/vi/abc123XYZ/hqdefault.jpg" });
    // Planned again the next week, under other capitals: the video is there.
    await k.op("plan_week", { week_start: NEXT_MON, mode: "final", meals: [meal(NEXT_MON, "Dinner", "Rajma Chawal")] });
    expect(dishIn(await weekOf(k, NEXT_MON), NEXT_MON, "Dinner", "Rajma Chawal").video.url).toBe(RAJMA_VIDEO);
    // get_dish reads it.
    expect((await k.op("get_dish", { dish: "Rajma chawal" })).dish.video.url).toBe(RAJMA_VIDEO);
    // Only a link: no file.
    expect(k.rows("dish_book")).toHaveLength(1);
  });

  it("a reel the family saved for a dish (by dish_id) is its video; another video takes its place; remove takes it away", async () => {
    const k = await start();
    const { dish: d } = await k.op("set_dish", { date: MON, slot: "Dinner", ...dish("Paneer tikka", "paneer") });
    const r = await k.op("set_dish_video", { dish_id: d.id, url: REEL, thumbnail: "https://cdn.instagram.com/thumb.jpg" });
    expect(r.dish.video).toEqual({ url: REEL, title: null, thumbnail: "https://cdn.instagram.com/thumb.jpg" });
    await k.op("set_dish_video", { dish: "Paneer tikka", url: RAJMA_VIDEO });
    expect((await k.op("get_dish", { dish: "paneer tikka" })).dish.video).toEqual({ url: RAJMA_VIDEO, title: null, thumbnail: "https://i.ytimg.com/vi/abc123XYZ/hqdefault.jpg" });
    expect((await k.op("set_dish_video", { dish: "Paneer tikka", remove: true })).dish.video).toBeNull();
    expect(dishIn(await weekOf(k, MON), MON, "Dinner", "Paneer tikka").video).toBeNull();
    expect((await k.op("set_dish_video", { dish: "Paneer tikka", remove: true })).status).toBe(404);
  });

  it("a video sent with a planned dish (video_url) becomes the dish's own, so next week shows it too", async () => {
    const k = await start();
    await k.op("plan_week", { week_start: MON, mode: "final", meals: [{ date: MON, slot: "Lunch", dishes: [{ ...dish("Bhindi"), video_url: REEL }] }] });
    await k.op("plan_week", { week_start: NEXT_MON, mode: "final", meals: [meal(NEXT_MON, "Lunch", "Bhindi")] });
    expect(dishIn(await weekOf(k, NEXT_MON), NEXT_MON, "Lunch", "Bhindi").video.url).toBe(REEL);
  });

  it("refuses anything but a link, and a dish it cannot name", async () => {
    const k = await start();
    expect((await k.op("set_dish_video", { dish: "Rajma", url: "rajma.mp4" })).error).toContain("url must be a link");
    expect((await k.op("set_dish_video", { dish: "Rajma", url: RAJMA_VIDEO, thumbnail: "data:image/png;base64,xx" })).error).toContain("thumbnail must be a link");
    expect((await k.op("set_dish_video", { dish_id: "nope", url: RAJMA_VIDEO })).error).toContain("no planned dish");
    expect((await k.op("set_dish_video", { url: RAJMA_VIDEO })).error).toContain("dish");
    expect((await k.op("get_dish", { dish: "never heard of it" })).dish).toEqual({ name: "never heard of it", video: null, rating: null, note: null, rated_on: null, said_by: null, history: [] });
  });
});

describe("how a dish went", () => {
  it("keeps the latest rating with its note, date and who said it, and a short history, newest first", async () => {
    const k = await start();
    const r = await k.op("rate_dishes", { ratings: [
      { dish: "Bhindi", rating: "didn't work", note: "too oily", said_by: "Ankita" },
      { dish: "Dal tadka", rating: "good", said_by: "Shiva" }] });
    expect(r.dishes.map((d: any) => [d.name, d.rating, d.note, d.rated_on, d.said_by])).toEqual([["Bhindi", "didnt_work", "too oily", MON, "Ankita"], ["Dal tadka", "good", null, MON, "Shiva"]]);
    // A later day's rating is the latest; one for an earlier day joins the history without taking its place.
    const k2 = await start(19, 25);
    await k2.op("rate_dishes", { date: MON, ratings: [{ dish: "Bhindi", rating: "okay", note: "better", said_by: "Ankita" }] });
    await k2.op("rate_dishes", { date: "2026-11-20", ratings: [{ dish: "Bhindi", rating: "bad", note: "burnt" }] });
    const got = (await k2.op("get_dish", { dish: "bhindi" })).dish;
    expect([got.rating, got.note, got.rated_on]).toEqual(["okay", "better", MON]);
    expect(got.history.map((h: any) => h.date)).toEqual([MON, "2026-11-20"]);
  });

  it("the same person on the same day replaces their answer; at most 5 are kept", async () => {
    const k = await start(19, 30);
    await k.op("rate_dishes", { date: MON, ratings: [{ dish: "Poha", rating: "good", said_by: "Ankita" }] });
    await k.op("rate_dishes", { date: MON, ratings: [{ dish: "Poha", rating: "okay", note: "a bit dry", said_by: "ankita" }] });
    expect((await k.op("get_dish", { dish: "Poha" })).dish.history).toEqual([{ rating: "okay", note: "a bit dry", date: MON, by: "ankita" }]);
    for (const day of [24, 25, 26, 27, 28, 29]) await k.op("rate_dishes", { date: `2026-11-${day}`, ratings: [{ dish: "Poha", rating: "good" }] });
    const h = (await k.op("get_dish", { dish: "Poha" })).dish.history;
    expect(h.map((x: any) => x.date)).toEqual(["2026-11-29", "2026-11-28", "2026-11-27", "2026-11-26", "2026-11-25"]);
  });

  it("refuses a rating it does not know, a day still to come, and an empty list", async () => {
    const k = await start();
    expect((await k.op("rate_dishes", { ratings: [{ dish: "Poha", rating: "5 stars" }] })).error).toContain("good, okay, or didn't work");
    expect((await k.op("rate_dishes", { date: TUE, ratings: [{ dish: "Poha", rating: "good" }] })).error).toContain("after today");
    expect((await k.op("rate_dishes", { ratings: [] })).error).toContain("ratings must be a list");
  });

  it("the next time the dish is planned, its note shows with it; not on the day it was rated", async () => {
    const k = await start();
    await k.op("plan_week", { week_start: MON, mode: "final", meals: [meal(MON, "Lunch", "Bhindi")] });
    await k.op("rate_dishes", { ratings: [{ dish: "Bhindi", rating: "didnt_work", note: "too oily", said_by: "Ankita" }] });
    await k.op("plan_week", { week_start: NEXT_MON, mode: "final", meals: [meal(NEXT_MON, "Lunch", "Bhindi")] });
    expect(dishIn(await weekOf(k, MON), MON, "Lunch", "Bhindi").last_time).toBeNull();
    expect(dishIn(await weekOf(k, NEXT_MON), NEXT_MON, "Lunch", "Bhindi").last_time).toEqual({ rating: "didnt_work", note: "too oily", date: MON, by: "Ankita" });
  });
});

describe("the context a plan starts from", () => {
  it("lists every dish rated or with a video, the ones that did not work first, and the prompt says to plan those rarely", async () => {
    const k = await start();
    await k.op("rate_dishes", { ratings: [{ dish: "Aloo gobi", rating: "good" }, { dish: "Bhindi", rating: "didnt_work", note: "too oily" }] });
    await k.op("set_dish_video", { dish: "Rajma chawal", url: RAJMA_VIDEO });
    const { context } = await k.op("plan_week", { week_start: NEXT_MON, mode: "draft" });
    expect(context.known_dishes).toEqual([
      { dish: "Bhindi", rating: "didnt_work", note: "too oily", rated_on: MON, video_url: null },
      { dish: "Aloo gobi", rating: "good", note: null, rated_on: MON, video_url: null },
      { dish: "Rajma chawal", rating: null, note: null, rated_on: null, video_url: RAJMA_VIDEO }]);
    expect(WEEKLY_PROMPT(NEXT_MON)).toContain("known_dishes rated didnt_work: plan it rarely, not never");
  });
});

describe("the family's own dishes", () => {
  it("the interview's past week is saved by meal and eater, and the week's context lists it with how to plan from it", async () => {
    const k = await start();
    await k.op("set_person", { name: "Meera", group: "child" });
    await k.op("set_slots", { extra_slots: [{ name: "Meera's tiffin", days: ["Mon", "Tue"], for: ["Meera"] }] });
    const r = await k.op("set_family_dishes", { dishes: [
      { name: "Idli", slots: ["breakfast"] }, { name: "Plain dosa", slots: ["Breakfast"], for: ["meera"] },
      { name: "Rajma", slots: ["Lunch", "Dinner"] }, { name: "Poha", slots: ["meera's tiffin", "Breakfast"] }] });
    expect(r.error).toBeUndefined();
    const { context } = await k.op("plan_week", { week_start: NEXT_MON, mode: "draft" });
    expect(context.family_dishes).toEqual({
      Breakfast: [{ dish: "Idli" }, { dish: "Plain dosa", for: ["Meera"] }, { dish: "Poha" }],
      Lunch: [{ dish: "Rajma" }], Dinner: [{ dish: "Rajma" }], "Meera's tiffin": [{ dish: "Poha" }] });
    expect(context.how_to_plan).toContain("Build the week from family_dishes");
    expect(context.how_to_plan).toContain('except ["Kabir"]');
    // A meal or a person the family does not have is told, with the closest; remove takes a dish off the list.
    expect((await k.op("set_family_dishes", { dishes: [{ name: "Upma", slots: ["Brekfast"] }] })).error).toContain("did you mean Breakfast?");
    expect((await k.op("set_family_dishes", { dishes: [{ name: "Upma", slots: ["Breakfast"], for: ["Mira"] }] })).error).toContain("did you mean Meera?");
    await k.op("set_family_dishes", { dishes: [{ name: "Rajma", remove: true }] });
    expect((await k.op("plan_week", { week_start: NEXT_MON, mode: "draft" })).context.family_dishes.Lunch).toBeUndefined();
  });
});

describe("the messages", () => {
  /** Monday: lunch at home (dal, bhindi, roti), dinner ordered in. Tuesday: lunch of rajma chawal and bhindi. */
  const planned = async (k: Awaited<ReturnType<typeof start>>, monday: object[] = [meal(MON, "Lunch", "Dal", "Bhindi", "Roti"), { date: MON, slot: "Dinner", ordered_in: true }]) => {
    const r = await k.op("plan_week", { week_start: MON, mode: "final", meals: [...monday, meal(TUE, "Lunch", "Rajma chawal", "Jeera aloo")] });
    expect(r.error).toBeUndefined();
  };

  it("the evening asks once how today's home food went, each dish once, staples and ordered-in meals aside", async () => {
    const k = await start();
    await planned(k);
    const r = await k.op("get_reminder", { which: "evening" });
    expect(r.rate_today).toEqual({ date: MON, dishes: ["Dal", "Bhindi"] });
    expect(r.text.split("\n\n").at(-1)).toBe("How was today's food: Dal and Bhindi? Good, okay or didn't work, and anything that went well or didn't?");
    expect(r.text.match(/How was today's food/g)).toHaveLength(1);
    expect(r.app_text).toContain("How was today's food: Dal and Bhindi?");
    expect(REMINDER_PROMPT("evening")).toContain("rate_dishes");
  });

  it("asks nothing about a day nothing was eaten at home, nor in the afternoon, nor about a dish already rated today", async () => {
    const k = await start();
    await planned(k, [{ date: MON, slot: "Lunch", ordered_in: true }]);
    const r = await k.op("get_reminder", { which: "evening" });
    expect(r.rate_today).toBeNull();
    expect(r.text).not.toContain("How was");

    const k2 = await start(15);
    await planned(k2);
    expect((await k2.op("get_reminder", { which: "afternoon" })).text).not.toContain("How was");

    const k3 = await start();
    await planned(k3);
    await k3.op("rate_dishes", { ratings: [{ dish: "dal", rating: "good" }] });
    expect((await k3.op("get_reminder", { which: "evening" })).rate_today).toEqual({ date: MON, dishes: ["Bhindi"] });
    await k3.op("rate_dishes", { ratings: [{ dish: "Bhindi", rating: "okay" }] });
    expect((await k3.op("get_reminder", { which: "evening" })).rate_today).toBeNull();
  });

  it("an evening with only today's food to ask about is not empty: the family is still asked", async () => {
    const k = await start();
    await k.op("plan_week", { week_start: MON, mode: "final", meals: [meal(MON, "Lunch", "Dal")] });
    const r = await k.op("get_reminder", { which: "evening" });
    expect(r.empty).toBe(false);
    expect(r.text).toBe("How was today's food: Dal? Good, okay or didn't work, and anything that went well or didn't?");
  });

  it("the cook's message carries last time's note and the dish's video for the day's dishes", async () => {
    const k = await start();
    await k.op("rate_dishes", { date: "2026-11-20", ratings: [{ dish: "Rajma chawal", rating: "okay", note: "too salty" }, { dish: "Jeera aloo", rating: "good" }] });
    await k.op("set_dish_video", { dish: "Rajma chawal", url: RAJMA_VIDEO });
    await planned(k);
    const r = await k.op("get_reminder", { which: "evening" });
    expect(r.text.split("\n").slice(0, 2)).toEqual(["Tomorrow: Rajma chawal, Jeera aloo", `Rajma chawal, last time: too salty. Video: ${RAJMA_VIDEO}`]);
    expect(r.text).not.toContain("Jeera aloo, last time");
  });

  it("the Sunday message carries Monday's dishes' videos and notes, and the agent is told those links are to be sent", async () => {
    const k = await start(11, 22);
    await k.op("rate_dishes", { ratings: [{ dish: "Bhindi", rating: "didnt_work" }] });
    await k.op("set_dish_video", { dish: "Dal", url: REEL });
    await k.op("plan_week", { week_start: MON, mode: "final", keep_rest: true, meals: [meal(MON, "Lunch", "Dal", "Bhindi")] });
    const r = await k.op("plan_week", { week_start: MON, mode: "final" });
    expect(r.message.split("\n").slice(0, 4)).toEqual(["Next week is planned.", "Monday: Dal, Bhindi", `Dal video: ${REEL}`, "Bhindi, last time: didn't work"]);
    expect(r.instructions).toContain("a dish's video");
  });
});
