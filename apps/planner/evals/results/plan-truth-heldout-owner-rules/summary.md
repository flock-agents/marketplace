# Eval 2 (plan, truth, held-out) — 2026-11-23T18:43

week 2026-11-30; model deepseek/deepseek-v4-flash; judges anthropic/claude-sonnet-5.5 + openai/gpt-5; 6.3 min; spend $0.366 (74 calls)

| run | filled | attendance | skips_kept | no_stray | hard_rules | from_library | new_budget | default_cap | dish_frequency | daily_dishes | repeat_window | same_day_repeat | guests | soft_frequency | hard_breaks | new_dishes | family_dish_share | unmet | flagged | judge_fits_dishes | judge_meal_shape | judge_variety | judge_per_person | judge_overall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| h9-mehta | 27/27 | 27/27 | 1/1 | 1/1 | 1/1 | 52/52 | 1/1 | 8/10 | 3/4 | 7/7 | 2/4 | 7/7 | – | – | 0 | 0 | 100 | 1 | 1 | 4.5 | 2.5 | 1.5 | 5 | 2.5 |
| h10-qureshi | 24/24 | 24/24 | 1/1 | 1/1 | 3/3 | 35/35 | 1/1 | 13/14 | 3/3 | – | 4/4 | 7/7 | 1/1 | – | 0 | 0 | 100 | 3 | 1 | 4.5 | 3.5 | 4.5 | 4.5 | 3.5 |
| h11-dsouza | 20/20 | 20/20 | 1/1 | 1/1 | 2/2 | 55/55 | 1/1 | 9/9 | 5/6 | – | 2/3 | 7/7 | – | 0/1 | 0 | 0 | 100 | 3 | 1 | 4.5 | 4 | 2.5 | 4 | 3 |
| h12-sen | 32/32 | 32/32 | – | 1/1 | 5/5 | 61/61 | 1/1 | 10/12 | 5/5 | – | 6/6 | 7/7 | – | – | 0 | 0 | 100 | 2 | 1 | 4.5 | 3 | 3 | 3.5 | 3 |
| **total** | 100% (103/103) | 100% (103/103) | 100% (3/3) | 100% (4/4) | 100% (11/11) | 100% (203/203) | 100% (4/4) | 89% (40/45) | 89% (16/18) | 100% (7/7) | 82% (14/17) | 100% (28/28) | 100% (1/1) | 0% (0/1) |  |  |  |  |  |  |  |  |  |  |

Judges' average: fits_dishes 4.5, meal_shape 3.3, variety 2.9, per_person 4.3, overall 3.0

Tracked, not gating (shape: dish count per slot-day within ±1 of the slot's history):

| run | shape |
|---|---|
| h9-mehta | 26/27 |
| h10-qureshi | 22/24 |
| h11-dsouza | 18/20 |
| h12-sen | 32/32 |
| **total** | 95% (98/103) |

## Misses

### h9-mehta
- default_cap: Dal (no frequency, not a staple) on 4 days: Mon Lunch, Tue Lunch, Thu Lunch, Sat Lunch
- dish_frequency: Khichdi (2/week) on Mon Ba's dinner, Wed Ba's dinner, Fri Ba's dinner, Sun Ba's dinner
- default_cap: Bhakri (no frequency, not a staple) on 6 days: Mon Dinner, Tue Dinner, Wed Dinner, Thu Dinner, Fri Dinner, Sat Dinner
- repeat_window: Lunch (window 2): Dal Mon and Tue
- repeat_window: Dinner (window 2): Bhakri Mon and Tue; Bhakri Tue and Wed; Bhakri Wed and Thu; Bhakri Thu and Fri; Bhakri Fri and Sat
- judge: Dinner is plain Bhakri alone six nights, with no shaak, khichdi or kadhi, though their dinners pair Bhakri with shaak and khichdi and kadhi are twice weekly. | All dinners are only bhakri with no shaak/khichdi/kadhi; repetitive and not their usual dinner shape.
- planner said unmet: Wed Breakfast: Thepla comes back sooner than usual

### h10-qureshi
- default_cap: Khichdi (no frequency, not a staple) on 3 days: Mon Zayan's dinner, Mon Lunch, Thu Zayan's dinner, Sun Zayan's dinner
- judge: Friday dinner for three guests is only roti and dal, and Monday lunch oddly combines dal chawal, roti and khichdi. | Monday lunch mixes khichdi with dal-chawal/roti instead of their usual dal-chawal-roti-sabzi or khichdi alone.
- planner said unmet: Sun Zayan's dinner: Khichdi comes back sooner than usual; Sat Lunch: Roti comes back sooner than usual; Sat Lunch: Sabzi comes back sooner than usual

### h11-dsouza
- dish_frequency: Rajma (rarely) on Wed Lunch, Sun Lunch
- repeat_window: Dinner (window 3): Chicken curry Sat and Sun; Egg curry Sat and Sun
- soft_frequency: millets three times a week for Vikram: 1 times (want 2–3)
- judge: Overnight oats twice, and Rajma and Chole both appear though rare. Sat/Sun dinners stack chicken, egg and fish together, and Sunday has three non-veg dishes. | Vikram’s millet preference is missed—only one millet-based meal instead of the three he wants each week.
- planner said unmet: Sun Dinner: Chicken curry comes back sooner than usual; Sun Dinner: Egg curry comes back sooner than usual; Sun Lunch: Rajma comes back sooner than usual

### h12-sen
- default_cap: Dal (no frequency, not a staple) on 7 days: Mon Dinner, Tue Dinner, Wed Dinner, Thu Dinner, Fri Dinner, Sat Dinner, Sun Dinner
- default_cap: Roti (no frequency, not a staple) on 7 days: Mon Dinner, Tue Dinner, Wed Dinner, Thu Dinner, Fri Dinner, Sat Dinner, Sun Dinner
- judge: Every dinner is just Dal, Roti with no Aloo posto or Gatte ki sabzi, unlike their past dinners, so dinners are bare and repetitive. | Dinner is only dal and roti every night, missing the usual sabzi and feeling repetitive.
- planner said unmet: Wed Mili's tiffin: Sandwich comes back sooner than usual; Thu Mili's tiffin: Paratha roll comes back sooner than usual

## Top failure kinds

- default_cap: 5
- judge: 4
- planner said unmet: 4
- repeat_window: 3
- dish_frequency: 2
- soft_frequency: 1
