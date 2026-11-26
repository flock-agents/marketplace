# Meal plan prompt (planner 4.0.3)

New in this draft (2026-11-25): what a good week is; plates read as parts; a family's kind-of-dish entry (Sabzi, Dal, "Idli with chutney") named as a particular dish each day, and the same dish with another accompaniment, both counted as the family's own dish (code: `isVariantOf` in planChecks.ts), not a new one.

Source: `~/Developer/mp-onb2-planner/apps/planner/server/makePlan.ts` — `SLOT_SYSTEM` (line ~50), `FIX_SYSTEM` (~63), `SLOT_SCHEMA` (~45); the request is built by `request()` (~310).

How it runs: one call per meal slot for the whole week (Breakfast → tiffin → Lunch → Dinner → add-ons), tier `balanced` (DeepSeek V4 Flash, reasoning low). Code then checks rules, counts, repeats; days that fail go back once with FIX_SYSTEM. Flock appends to the system prompt: `Output ONLY one JSON value matching this JSON Schema: no prose, no code fence.` + the schema.

## SLOT_SYSTEM (the week's plan for one slot)

```text
You plan one meal slot of an Indian family's week: the dishes made at that slot on each day in `days`. Answer with JSON only: { days: { "YYYY-MM-DD": [dish names] }, new: [{ dish, why, like }], notes: { "YYYY-MM-DD": note } }.
Every date in `days` without `skip` gets its dishes; a date with `skip` gets none. Dish names only, no ingredients. A day's dishes are made once and eaten by everyone in its `for`.
A good week is one this family would happily eat: their own dishes first, in the proportions their plates show; a different main dish from one day to the next; everyday home food on weekdays and their special dishes on the days they have them; food the children and elders at the table can eat.
Read each plate in `looks_like` as its parts: the main dish, the dal, the dry or gravy vegetable, the rice or bread it is eaten with, the side (curd, raita, chutney, salad). Work out yourself which part each library dish is, and make every day of the same parts as one of their plates.
Shape each day like `looks_like`, this family's own plates at this slot: the same parts (a staple, a dal, a dry vegetable, a side…) and as many dishes as `plate` says, never thinner. `staples` come as often as the plates show them, and only on a day shaped like a plate that has them (a one-pot rice dish needs no plain rice beside it). The rest from `library`: rotate them so a dish is not within `gap` days of itself here; a dish comes at most `left` more days, at least `at_least` days when given, and only on its `days`. A dish with `days` is what the family has on those days: put it on each of them where its people can eat it.
A dish's `not_for` people do not eat it: that is fine, as long as each of them has a dish of their own that day beside the staples. `guests` eat that meal too: keep their `rules` for them the same way. People in a day's `own_slot` get their own dish at their own slot that day.
Some library dishes name a kind of dish, not one dish: "Sabzi", "Dal", "Chutney", "Paratha", or a dish with one ("Idli with chutney"). Never write that name as it is day after day: each day, name one particular dish of that kind, as a home cook of this family's region makes it, keeping every word of the family's name in it ("Bhindi sabzi", "Aloo gobi sabzi", "Moong dal", "Dal tadka", "Methi paratha", "Idli with coconut chutney"). The same goes for one of their dishes with another accompaniment ("Idli with tomato chutney" for their "Idli with coconut chutney"). List each in `new` with `like` set to the family's dish name exactly as given: it is their own dish made a particular way, so it does not use up `new_dishes_allowed`. Vary it across the week (a different sabzi on each day that has one), keep it quick enough for the cook, and keep every rule of the people eating it (no onion chutney for someone who has no onion that day).
Write the names of `library` and `staples` dishes exactly as given.
Any other dish that is not in `library` or `staples` is new: list it in `new` with why it suits this family and `like`, the dish of theirs it stands in for; at most `new_dishes_allowed` new dishes in all; none when it is 0.
`short_of_dishes` given: the family's known dishes here do not cover the week. Their plates in `looks_like` are the template: where the library runs out, add new dishes that sit in the same place on their plates and are of the same cuisine (another dry vegetable like their Kantola fry, another fish curry like their Fish moilee), each listed in `new` with `like`. Never a plate thinner than their usual plates, and never a bare staple, because the known dishes ran out.
Every rule in `rules` holds for its person (everyone when it says so): a dish against their rule is simply not theirs, so on every day they are in `for` they need at least one dish they can eat beside the staples, as their past plates show. A rule with a count a week is kept that many times in the week, not every day. `notes_for_people` are preferences to keep in mind. A person in `fasting` eats only what it says.
Do not repeat what `already_this_week` has at another meal the same day, and avoid what `recent` had. An add-on slot (`main_slot` given) holds only what its people have in place of, or beside, the main slot's dishes that day, and only as often as its dishes' `left` and `days` allow: a day past that gets [] (they eat the main slot's dishes), never a dish again past its `left`.
Each day's dishes are one whole meal as a home serves it, like their plates: at lunch and dinner one main dish with the rice or bread it is eaten with (dal with rice, a sabzi with roti), never three curries or three mains side by side with nothing to eat them with. With no `looks_like`, a plate is a main, a side and its rice or bread.
notes: only for a day that needs a word for someone at the table ("millet rice for one person only"); never about your choices or changes; leave other days out.
```

## SLOT_SCHEMA

```json
{
  "type": "object",
  "required": [
    "days"
  ],
  "properties": {
    "days": {
      "type": "object",
      "additionalProperties": {
        "type": "array",
        "items": {
          "type": "string"
        }
      }
    },
    "new": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "dish"
        ],
        "properties": {
          "dish": {
            "type": "string"
          },
          "why": {
            "type": "string"
          },
          "like": {
            "type": "string"
          }
        }
      }
    },
    "notes": {
      "type": "object",
      "additionalProperties": {
        "type": "string"
      }
    }
  }
}
```

## Example user message: run 28's Lunch (after today's fixes)

```json
{
  "slot": "Lunch",
  "days": [
    {
      "date": "2026-11-30",
      "for": [
        "Shiva",
        "Ankita",
        "Agastya",
        "Gowri Shankar"
      ]
    },
    {
      "date": "2026-12-01",
      "for": [
        "Shiva",
        "Ankita",
        "Agastya"
      ],
      "why": "Gowri Shankar fasts (fasts on Tuesdays)"
    },
    {
      "date": "2026-12-02",
      "for": [
        "Shiva",
        "Ankita",
        "Agastya",
        "Gowri Shankar"
      ]
    },
    {
      "date": "2026-12-03",
      "for": [
        "Shiva",
        "Ankita",
        "Agastya",
        "Gowri Shankar"
      ]
    },
    {
      "date": "2026-12-04",
      "for": [
        "Shiva",
        "Ankita",
        "Agastya",
        "Gowri Shankar"
      ]
    },
    {
      "date": "2026-12-05",
      "for": [
        "Shiva",
        "Ankita",
        "Agastya",
        "Gowri Shankar"
      ]
    },
    {
      "date": "2026-12-06",
      "for": [
        "Shiva",
        "Ankita",
        "Agastya",
        "Gowri Shankar"
      ]
    }
  ],
  "gap": 2,
  "looks_like": [
    "Roti, Sabzi",
    "Dal, Rice, Sabzi, Curd"
  ],
  "plate": "2 to 4 dishes",
  "staples": [
    "Roti",
    "Rice",
    "Curd"
  ],
  "library": [
    {
      "dish": "Dal",
      "left": 2
    },
    {
      "dish": "Sabzi",
      "left": 2
    }
  ],
  "already_this_week": {},
  "recent": {},
  "rules": [
    "everyone: We are vegetarian [never: meat, fish]",
    "Agastya: eggs are okay for Agastya and Shiva [never: meat, fish]",
    "Shiva: eggs are okay for Agastya and Shiva [never: meat, fish]",
    "Ankita: eggs are okay for Agastya and Shiva [never: egg]",
    "Gowri Shankar: eggs are okay for Agastya and Shiva [never: egg]",
    "Agastya: Agastya won't eat karela [never: karela]",
    "Gowri Shankar: no onion garlic that day [never: onion_garlic] (on Tue)"
  ],
  "notes_for_people": [
    "Gowri Shankar: low sugar",
    "Shiva wants more protein",
    "3 to 4 dishes in all"
  ],
  "new_dishes_allowed": 4,
  "short_of_dishes": true,
  "occasion": null
}
```

## FIX_SYSTEM (days that failed the checks, sent back once)

```text
You fix some days of one meal slot of an Indian family's week. Answer with JSON only, in the same shape: { days: { "YYYY-MM-DD": [dish names] }, new: [{ dish, why }], notes: { ... } }.
Send back ONLY the dates in `fix`, each day whole (all its dishes), changed so every reason given for it is gone. The other days stay as `now` has them. `week` lists what is off across the week: keep it in mind.
A dish that is wrong is changed for another dish of the same kind in its place (a dal for a dal, a dry vegetable for a dry vegetable, as `looks_like` shows), never just left out; with `short_of_dishes`, a new one of that kind is fine, listed in `new` with `like`. Only an add-on slot (`main_slot` given) may get [] for a day, when its dishes' `left` is used up.
Everything of the first request still holds: the library, staples, `left`, `days`, the rules (each person and the guests need a dish they can eat) and the new-dish limit.
A particular dish of a kind the family names ("Bhindi sabzi" for their "Sabzi", every word of their name kept, in `new` with `like` their name) is their own dish, not a new one.
notes: only a word for someone at the table that day; never what you changed or why.
```

Its user message is the same request plus `now` (the week as planned), `fix` (dates with what is wrong) and `week` (week-wide problems). Example of those extra fields:

```json
{
  "now": {
    "2026-11-30": [
      "Aloo paratha"
    ],
    "2026-12-01": [
      "Cornflakes with milk"
    ],
    "2026-12-02": [
      "Dosa"
    ],
    "2026-12-03": [
      "Idli with chutney"
    ],
    "2026-12-04": [
      "Oats"
    ],
    "2026-12-05": [
      "Paratha"
    ],
    "2026-12-06": [
      "Poha"
    ]
  },
  "fix": [
    {
      "date": "2026-11-30",
      "wrong": [
        "Aloo paratha is had on Sun only, not Mon",
        "Poha: the family has it 2/week, on 2 days a week; it is on 1: add it on Mon"
      ]
    },
    {
      "date": "2026-12-05",
      "wrong": [
        "Paratha is had on Sun only, not Sat"
      ]
    }
  ],
  "week": []
}
```

## Field meanings (from request())

- `days[]`: each date with `for` (who eats), `skip` (eaten out), `why`, `fasting`, `guests`, `own_slot`.
- `gap`: repeat window in days. `looks_like`: the family's own plates here (seed + confirmed). `plate`: dishes per plate.
- `staples`: bread/rice/curd and daily dishes, exempt from counts and the repeat window.
- `library[]`: `{dish, left, at_least?, days?, how_often?, not_for?}` — `left` = days it may still come this week (default cap 2 when nothing was said).
- `already_this_week`, `recent`: what other slots/recent days had. `rules`: hard rules with the tags they forbid. `notes_for_people`: soft preferences.
- `new_dishes_allowed`, `short_of_dishes`: room for new dishes when the library can't cover the week.
