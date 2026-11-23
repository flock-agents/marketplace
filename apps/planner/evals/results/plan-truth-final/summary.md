# Eval 2 (plan, truth) — 2026-11-23T17:13

week 2026-11-30; model deepseek/deepseek-v4-flash; judges anthropic/claude-sonnet-5.5 + openai/gpt-5; 8.5 min; spend $0.700 (189 calls)

| run | filled | attendance | skips_kept | no_stray | hard_rules | from_library | new_budget | default_cap | dish_frequency | repeat_window | same_day_repeat | guests | soft_frequency | cap_rules | guest_rules | daily_dishes | hard_breaks | new_dishes | family_dish_share | unmet | flagged | judge_fits_dishes | judge_meal_shape | judge_variety | judge_per_person | judge_overall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| h1-sharma | 25/25 | 25/25 | 1/1 | 1/1 | 1/1 | 62/62 | 1/1 | 13/14 | 5/5 | 3/4 | 7/7 | – | – | – | – | – | 0 | 0 | 100 | 2 | 1 | 5 | 3.5 | 4.5 | 5 | 4 |
| h2-iyer | 20/20 | 20/20 | 1/1 | 1/1 | 3/3 | 62/62 | 1/1 | 12/12 | 5/6 | 3/3 | 7/7 | 1/1 | – | – | – | – | 0 | 0 | 100 | 0 | 0 | 5 | 3.5 | 3.5 | 5 | 4 |
| h3-shiva | 30/30 | 30/30 | 3/3 | 1/1 | 7/7 | 60/60 | 1/1 | 16/18 | 7/7 | 4/5 | 7/7 | – | 1/1 | 6/6 | – | – | 0 | 0 | 100 | 7 | 1 | 4.5 | 3.5 | 3 | 4 | 3.5 |
| h4-reddy | 40/40 | 40/40 | – | 1/1 | 4/4 | 92/92 | 1/1 | 18/21 | 2/2 | 6/6 | 7/7 | – | 0/1 | – | – | – | 0 | 0 | 100 | 5 | 1 | 5 | 3 | 3 | 2.5 | 3 |
| h5-agarwal | 26/26 | 26/26 | – | 1/1 | 4/4 | 55/55 | 1/1 | 10/11 | 3/3 | 2/4 | 7/7 | – | – | – | – | – | 0 | 0 | 100 | 7 | 1 | 4.5 | 2 | 2.5 | 2 | 2.5 |
| h6-kulkarni | 26/26 | 26/26 | – | 1/1 | 2/2 | 62/62 | 1/1 | 12/13 | 5/5 | 1/4 | 7/7 | 1/1 | – | – | 1/1 | – | 0 | 0 | 100 | 7 | 1 | 4.5 | 3.5 | 3 | 2 | 3 |
| h7-menon | 18/18 | 18/18 | 3/3 | 1/1 | 1/1 | 52/52 | 1/1 | 7/9 | 3/3 | 2/3 | 7/7 | – | – | – | – | 7/7 | 0 | 1 | 98 | 2 | 1 | 4 | 4 | 3.5 | 5 | 4 |
| h8-banerjee | 33/33 | 33/33 | – | 1/1 | 1/4 | 77/77 | 1/1 | 13/13 | 5/5 | 5/5 | 7/7 | – | – | – | – | – | 3 | 0 | 100 | 3 | 1 | 4.5 | 4 | 4 | 2.5 | 3 |
| **total** | 100% (218/218) | 100% (218/218) | 100% (8/8) | 100% (8/8) | 88% (23/26) | 100% (522/522) | 100% (8/8) | 91% (101/111) | 97% (35/36) | 76% (26/34) | 100% (56/56) | 100% (2/2) | 50% (1/2) | 100% (6/6) | 100% (1/1) | 100% (7/7) |  |  |  |  |  |  |  |  |  |  |

Judges' average: fits_dishes 4.6, meal_shape 3.4, variety 3.4, per_person 3.5, overall 3.4

Tracked, not gating (shape: dish count per slot-day within ±1 of the slot's history):

| run | shape |
|---|---|
| h1-sharma | 23/25 |
| h2-iyer | 20/20 |
| h3-shiva | 25/30 |
| h4-reddy | 39/40 |
| h5-agarwal | 25/26 |
| h6-kulkarni | 24/26 |
| h7-menon | 18/18 |
| h8-banerjee | 33/33 |
| **total** | 95% (207/218) |

## Misses

### h1-sharma
- default_cap: Aloo gobi (no frequency, not a staple) on 3 days: Mon Lunch, Thu Dinner, Fri Lunch
- repeat_window: Dinner (window 3): Paneer bhurji Mon and Wed
- judge: Friday lunch merges dal-chawal-roti meal with Rajma chawal, and Friday tiffin has two items (Paratha roll plus Maggi), unlike their single-item pattern. | Friday lunch combines Rajma chawal with dal–roti–sabzi; not their usual shape. Also Friday tiffin lists two items instead of one.
- planner said unmet: Mon Dinner: Paneer bhurji comes back sooner than usual; Thu Dinner: Aloo gobi comes back sooner than usual

### h2-iyer
- dish_frequency: Kootu (sometimes) on Thu Lunch
- judge: Ragi porridge twice at breakfast (Mon, Thu), and Rasam rice (a sometimes dish) plus Uthappam (sometimes) used often; Thu dinner pairs Kurma with Rasam rice, which is an odd combination. | Thu dinner pairs kurma with rasam rice; that doesn't match their usual dinner pattern.

### h3-shiva
- default_cap: Bhindi (no frequency, not a staple) on 4 days: Mon Dinner, Wed Lunch, Thu Dinner, Fri Lunch
- default_cap: Aloo gobi (no frequency, not a staple) on 4 days: Tue Lunch, Wed Dinner, Fri Dinner, Sun Dinner
- repeat_window: Lunch (window 2): Sambar Tue and Wed
- judge: Bhindi and aloo gobi repeat four times each; lunches carry four items against the two-dish limit; Tuesday dinner note conflicts with phulka. | Bhindi and aloo gobi are repeated too often; rotate more vegetables for variety.
- planner said unmet: only 6 Dinner dishes known, so some come back more often than usual; only 1 Gowri Shankar's dinner dish known, so some come back more often than usual; Tue Lunch: Aloo gobi comes back sooner than usual; Wed Lunch: Bhindi comes back sooner than usual; Wed Lunch: Sambar comes back sooner than usual; Fri Lunch: Bhindi comes back sooner than usual; Fri Lunch: Sambar comes back sooner than usual

### h4-reddy
- default_cap: Pappu (no frequency, not a staple) on 3 days: Mon Dinner, Thu Dinner, Sun Dinner
- default_cap: Beans curry (no frequency, not a staple) on 4 days: Mon Lunch, Thu Lunch, Sat Dinner, Sun Lunch
- default_cap: Bendakaya curry (no frequency, not a staple) on 3 days: Tue Lunch, Wed Dinner, Fri Lunch
- soft_frequency: ragi is good for Sarojini, a few times a week: 14 times (want 2–3)
- judge: Weekday lunches list only Sarojini and Venkat, leaving out Srinivas and Padma; dinners of plain Chapati with Rice or Pappu lack a curry and repeat. | Weekday lunches list only grandparents; Padma (and Srinivas on Mon/Tue/Fri) are wrongly omitted though only Karan is away at lunch.
- planner said unmet: only 2 Sarojini's breakfast dishes known, so some come back more often than usual; only 1 Sarojini's dinner dish known, so some come back more often than usual; Sun Lunch: Beans curry comes back sooner than usual; Wed Dinner: Bendakaya curry comes back sooner than usual; Sat Dinner: Beans curry comes back sooner than usual

### h5-agarwal
- default_cap: Aloo sandwich (no frequency, not a staple) on 3 days: Mon Reyansh's tiffin, Tue Reyansh's tiffin, Thu Reyansh's tiffin
- repeat_window: Lunch (window 2): Kadhi chawal Mon and Tue; Bhindi Fri and Sat
- repeat_window: Reyansh's tiffin (window 3): Aloo sandwich Mon and Tue; Aloo sandwich Tue and Thu
- judge: Ramesh's no onion/garlic rule is missing on Sunday meals and only partly stated elsewhere; Kamla's Tuesday rule is ignored; Kadhi chawal is served with dal three times. | Kamla’s Tue/Sat no onion/garlic rule is ignored in multiple meals.
- planner said unmet: only 4 Dinner dishes known, so some come back more often than usual; Tue Reyansh's tiffin: Aloo sandwich comes back sooner than usual; Thu Reyansh's tiffin: Aloo sandwich comes back sooner than usual; Tue Lunch: Kadhi chawal comes back sooner than usual; Wed Lunch: Aloo matar comes back sooner than usual; Fri Lunch: Bhindi comes back sooner than usual; Sat Lunch: Bhindi comes back sooner than usual

### h6-kulkarni
- default_cap: Bhakri (no frequency, not a staple) on 5 days: Mon Dinner, Wed Dinner, Thu Dinner, Fri Dinner, Sun Dinner
- repeat_window: Breakfast (window 3): Upma Mon and Wed; Poha Wed and Thu; Upma Wed and Thu; Thalipeeth Sat and Sun
- repeat_window: Dinner (window 2): Pithla Tue and Wed; Bhakri Wed and Thu; Bhakri Thu and Fri; Usal Thu and Fri
- repeat_window: Snack box (window 3): Idli Tue and Wed
- judge: Saturday dinner is fish fry although four vegetarian guests are coming; no vegetarian main is offered. | Saturday dinner ignores four vegetarian guests; only fish fry served, no vegetarian main for them.
- planner said unmet: only 5 Dinner dishes known, so some come back more often than usual; Wed Breakfast: Upma comes back sooner than usual; Thu Breakfast: Poha comes back sooner than usual; Thu Breakfast: Upma comes back sooner than usual; Fri Breakfast: Sheera comes back sooner than usual; Sun Breakfast: Thalipeeth comes back sooner than usual; Wed Snack box: Idli comes back sooner than usual

### h7-menon
- default_cap: Chicken curry (no frequency, not a staple) on 3 days: Mon Lunch, Thu Lunch, Fri Lunch
- default_cap: Paneer (no frequency, not a staple) on 3 days: Tue Dinner, Wed Lunch, Sun Dinner
- repeat_window: Lunch (window 3): Chicken curry Thu and Fri
- judge: Chicken repeats heavily (curry Mon, Thu, Fri; chicken dinners Mon, Thu), and Friday dinner pairs roti with biryani; Thursday's cheela isn't one of their dishes. | Friday dinner pairs roti with biryani and no curry—doesn’t match their usual roti + curry + sabzi dinner.
- planner said unmet: Wed Lunch: Paneer comes back sooner than usual; Fri Lunch: Chicken curry comes back sooner than usual

### h8-banerjee
- hard_rules: Gita: vegetarian, no fish, meat or eggs: Sun Lunch: nothing for Gita but staples
- hard_rules: Gita: no onion or garlic: Sun Lunch: nothing for Gita but staples
- hard_rules: No beef or pork: Sun Lunch: nothing for Gita but staples
- judge: Wed breakfast annotations are odd: 'no bread for Pradip' and an instruction leaking into the plan. Sat lunch has no fish; Sun luchi/alur dom has odd restrictions for Gita; sugar notes are nonsensical. | Gita's no onion-and-garlic rule is inconsistent; Sunday wrongly bans her potato, and Wednesday wrongly bans bread for Pradip.
- planner said unmet: only 4 Dinner dishes known, so some come back more often than usual; only 1 Gita's dinner dish known, so some come back more often than usual; Sun Lunch: Gita has nothing to eat on 2026-12-06 Lunch but staples

## Top failure kinds

- default_cap: 10
- repeat_window: 8
- judge: 8
- planner said unmet: 7
- hard_rules: 3
- dish_frequency: 1
- soft_frequency: 1
