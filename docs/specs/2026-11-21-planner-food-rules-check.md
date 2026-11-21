# Meal Planner: food rules the app checks (2026-11-21)

Owner, after live run 11: "rules missing is a crime. Loses trust immediately." A plan that breaks a rule the family
said must never be saved. The model writes the plan; the APP refuses any plan that breaks a checkable rule, naming each
break, so the agent fixes it before anyone sees it.

What went wrong in run 11 (the plan for 23–29 Nov): Meera's breakfast rule ("only plain idli, plain dosa or banana
sheera") broken on Mon (rava idli) and Thu (oats dosa); Lakshmi (diabetic, no white rice) given rice idli/dosa at
breakfast with no swap; no breakfast for Lakshmi's Thursday fast; Fri dinner without protein for Shiva. All of them
were stored as free text in people notes, which no code reads.

## The rule (one shape, on the house's `rules` list)

```
{ kind, who?, days?, slots?, items?, to?, per_week?, note? }
```
- `who`: one person's name as on the Family page (people.name). Left out: everyone.
- `days`: weekdays (Mon..Sun). Left out: every day. `slots`: meal slot names (Breakfast, Lunch, Dinner, an extra slot
  such as "Agastya's tiffin"). Left out: every slot.
- `items`: words or phrases matched against a dish's NAME and its INGREDIENTS, or a category `@name` (below).
- `note`: the family's own words, kept for the Family page and the agent.

Kinds that are CHECKED:
| kind | meaning | needs |
|---|---|---|
| `avoid` | no dish that `who` eats (in `days`/`slots`) contains any of `items` | items |
| `only` | every dish `who` eats in `slots` (and `days`) is one of `items` (dish names) | who, slots, items |
| `swap` | a dish `who` eats that contains any of `items` carries a portion_note naming `who` and `to`, or `who` gets a dish of their own | who, items, to |
| `require` | in each of `slots` (and `days`), `who` eats at least one dish containing one of `items` | slots, items |
| `cap` | dishes matching `items` are in at most `per_week` meals of the week | items, per_week |

Existing kinds keep working and are checked as:
- `veg` → avoid `@meat`, `@fish`; `no_meat` → same; `no_eggs` → avoid `@egg`; `egg` → avoid `@meat`, `@fish`.
- `no_onion_garlic` → avoid `onion`, `garlic` on its `days`.
- `fasting`, `other`: not checked (note only) unless given as one of the checked kinds.

## Who eats a dish
Owner, 2026-11-22: every planned dish says exactly who eats it, so the check reads what is written, with no guessing.
- Every dish the agent plans (`plan_week` with meals, `set_meal` dishes, `set_dish` adding a dish) carries `for`: a
  non-empty list of names on the Family page, or `["everyone"]` alone. A missing or empty `for`, a name not on the Family
  page (with "did you mean"), or "everyone" mixed with names is refused with code `MISSING_EATERS`, every such dish named
  (`missing_eaters`), in the same refusal as missing ingredients and rule breaks (`RULE_BROKEN` wins the code when there are
  breaks). `set_dish` changing a dish already there keeps its `for` unless one is sent.
- "everyone" (stored as `["everyone"]`) is everyone who eats that meal: the people of an extra slot that has its own
  `for` ("Agastya's tiffin": Agastya), else everyone on the Family page.
- A person eats exactly the dishes whose `for` names them, and the dishes for everyone while they eat that meal. A dish
  with no `for` (the family's own edits, which are never forced, and rows from before) is for everyone.
- So "Meera gets plain idli" is `Plain idli` `for: ["Meera"]` and the shared dish names everyone else; a swap stays a
  `portion_note` on a dish the person eats ("millet instead of rice for Lakshmi").
- A rule for one person holds only in the meals they eat (an `only` rule for Meera says nothing about Agastya's tiffin);
  a `require` with no `who` holds for everyone who eats that meal.
- The same dish sent once per person in a meal is one dish eaten by all of theirs (`["everyone"]` when one of them is for
  everyone, or when together they name everyone who eats the meal).

## Matching
Lower case, words only; a trailing plural `s`/`es` is dropped on both sides; a phrase matches as consecutive words.
Before matching a dish NAME, negations are removed: anything in brackets that starts with no/without/minus, and
"without X"/"no X" — "Lemon rice (no peanuts)" does not contain peanut. Ingredients are matched as given.
Categories (built into the app, extendable): `@meat`, `@fish`, `@egg`, `@nuts`, `@peanut` (peanut, groundnut,
moongphali, peanut butter, groundnut oil), `@root_veg` (onion, garlic, potato, carrot, beetroot, radish, sweet potato,
ginger, yam, arbi, turnip), `@green_leafy` (palak, spinach, methi, coriander, dill, curry leaves, beans, peas, capsicum,
broccoli), `@white_rice` (rice, basmati, sona masoori, idli rice, dosa rice, ponni, raw rice, boiled rice, poha, rice
flour, idli, dosa, appam, neer dosa), `@protein` (paneer, dal, toor, moong, masoor, urad, chana, chole, rajma, soya, tofu, sprouts,
curd, dahi, lobia, besan, egg, chicken, fish, mutton), `@mushroom`, `@baked` (bake, baked, cake, muffin, pizza, bread
loaf, garlic bread, oven).

## Where it is checked
- `plan_week` final by the agent (both the meals-given path and drafts made final), and `set_meal` / `set_dish` by the
  agent on a final week (that meal, plus `cap` over its week). Refused with code `RULE_BROKEN`, every break named:
  `Mon 2026-11-23 Breakfast: Rava idli — Meera eats only plain idli, plain dosa, banana sheera (add a dish for Meera)`.
  Also `rule_breaks: [{ meal, dish?, who?, rule, fix }]` in the body.
- Never on the family's own edits in the app (they may break their own rules).

## The interview writes rules in this shape
Every answer that states a rule is saved as a checked kind with `set_house_rules` (people's notes keep the story; the
rule is the rule). After the rules question, the Butler reads every saved rule back in plain words, one message, and
asks "Did I get these right?"; a correction is saved before the draft plan.

## Evals (no WhatsApp)
1. Planning: fixture households (run 11's + harsher ones) are seeded into a real planner app; the planning model writes
   the week through plan_week as the agent does (refusals fed back, up to 3 rounds); each fixture's OWN expectations
   (written from the family's words, not from the prompt) score the saved plan.
2. Interview capture: each fixture's answers, as said, go to the model with the setup questions' help; the rules it
   saves are compared with the fixture's expected rules.
