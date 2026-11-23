# Eval 2 (plan, truth) — 2026-11-23T18:36

week 2026-11-30; model deepseek/deepseek-v4-flash; judges off; 7.0 min; spend $0.064 (152 calls)

| run | filled | attendance | skips_kept | no_stray | hard_rules | from_library | new_budget | default_cap | dish_frequency | repeat_window | same_day_repeat | guests | soft_frequency | cap_rules | guest_rules | daily_dishes | hard_breaks | new_dishes | family_dish_share | unmet | flagged |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| h1-sharma | 25/25 | 25/25 | 1/1 | 1/1 | 1/1 | 54/54 | 1/1 | 14/14 | 5/5 | 4/4 | 7/7 | – | – | – | – | – | 0 | 1 | 100 | 0 | 0 |
| h2-iyer | 20/20 | 20/20 | 1/1 | 1/1 | 3/3 | 64/64 | 1/1 | 13/13 | 6/6 | 3/3 | 7/7 | 1/1 | – | – | – | – | 0 | 0 | 100 | 0 | 0 |
| h3-shiva | 26/26 | 26/26 | 3/3 | 1/1 | 7/7 | 57/57 | 1/1 | 16/17 | 6/7 | 4/5 | 6/7 | – | 1/1 | 6/6 | – | – | 0 | 0 | 100 | 4 | 1 |
| h4-reddy | 31/31 | 31/31 | – | 1/1 | 4/4 | 95/95 | 1/1 | 15/20 | 2/2 | 5/6 | 7/7 | – | 0/1 | – | – | – | 0 | 0 | 100 | 7 | 1 |
| h5-agarwal | 26/26 | 26/26 | – | 1/1 | 4/4 | 54/54 | 1/1 | 11/11 | 3/3 | 4/4 | 4/7 | – | – | – | – | – | 0 | 0 | 100 | 3 | 1 |
| h6-kulkarni | 26/26 | 26/26 | – | 1/1 | 2/2 | 59/59 | 1/1 | 12/12 | 5/5 | 1/4 | 7/7 | 1/1 | – | – | 1/1 | – | 0 | 0 | 100 | 3 | 1 |
| h7-menon | 18/18 | 18/18 | 3/3 | 1/1 | 1/1 | 52/52 | 1/1 | 8/9 | 3/3 | 3/3 | 7/7 | – | – | – | – | 7/7 | 0 | 1 | 98 | 1 | 1 |
| h8-banerjee | 28/28 | 28/28 | – | 1/1 | 4/4 | 70/70 | 1/1 | 12/12 | 5/5 | 5/5 | 7/7 | – | – | – | – | – | 0 | 0 | 100 | 1 | 1 |
| **total** | 100% (200/200) | 100% (200/200) | 100% (8/8) | 100% (8/8) | 100% (26/26) | 100% (505/505) | 100% (8/8) | 94% (101/108) | 97% (35/36) | 85% (29/34) | 93% (52/56) | 100% (2/2) | 50% (1/2) | 100% (6/6) | 100% (1/1) | 100% (7/7) |  |  |  |  |  |

Tracked, not gating (shape: dish count per slot-day within ±1 of the slot's history):

| run | shape |
|---|---|
| h1-sharma | 22/25 |
| h2-iyer | 20/20 |
| h3-shiva | 25/26 |
| h4-reddy | 23/31 |
| h5-agarwal | 26/26 |
| h6-kulkarni | 26/26 |
| h7-menon | 18/18 |
| h8-banerjee | 28/28 |
| **total** | 94% (188/200) |

## Misses

### h3-shiva
- default_cap: Dal (no frequency, not a staple) on 4 days: Wed Lunch, Wed Dinner, Fri Dinner, Sat Lunch, Sun Dinner
- dish_frequency: Rajma chawal (2/week) on Mon Lunch, Tue Lunch, Fri Lunch
- repeat_window: Lunch (window 2): Rajma chawal Mon and Tue; Aloo gobi Wed and Thu
- same_day_repeat: Wed: Dal at Lunch and Dinner; Aloo gobi at Lunch and Dinner
- planner said unmet: Rajma chawal at Lunch comes back sooner than usual (Tue, Fri); Dal at Lunch comes back sooner than usual (Wed, Sat); Aloo gobi at Lunch comes back sooner than usual (Wed, Thu); Fri Lunch: Bhindi comes back sooner than usual

### h4-reddy
- default_cap: Rice (no frequency, not a staple) on 7 days: Mon Dinner, Tue Dinner, Wed Dinner, Thu Dinner, Fri Dinner, Sat Dinner, Sun Dinner
- default_cap: Pappu (no frequency, not a staple) on 5 days: Mon Dinner, Thu Dinner, Fri Dinner, Sat Dinner, Sun Dinner
- default_cap: Dondakaya curry (no frequency, not a staple) on 6 days: Mon Lunch, Tue Dinner, Wed Dinner, Thu Lunch, Sat Dinner, Sun Lunch
- default_cap: Beans curry (no frequency, not a staple) on 6 days: Mon Dinner, Tue Lunch, Wed Dinner, Thu Dinner, Fri Lunch, Sun Dinner
- default_cap: Bendakaya curry (no frequency, not a staple) on 4 days: Tue Dinner, Wed Lunch, Fri Dinner, Sat Lunch
- repeat_window: Dinner (window 3): Rice Mon and Tue; Beans curry Mon and Wed; Dondakaya curry Tue and Wed; Rice Tue and Wed; Beans curry Wed and Thu; Rice Wed and Thu; Pappu Thu and Fri; Rice Thu and Fri; Pappu Fri and Sat; Rice Fri and Sat; Pappu Sat and Sun; Rice Sat and Sun
- soft_frequency: ragi is good for Sarojini, a few times a week: 5 times (want 2–3)
- planner said unmet: Rice at Dinner comes back sooner than usual (Tue, Wed, Thu, Fri, Sat, Sun); Beans curry at Dinner comes back sooner than usual (Wed, Thu, Sun); Dondakaya curry at Dinner comes back sooner than usual (Wed, Sat); Pappu at Dinner comes back sooner than usual (Fri, Sat, Sun); Dondakaya curry at Lunch comes back sooner than usual (Mon, Thu, Sun); Beans curry at Lunch comes back sooner than usual (Tue, Fri); Bendakaya curry at Lunch comes back sooner than usual (Wed, Sat)

### h5-agarwal
- same_day_repeat: Tue: Bhindi at Lunch and Dinner
- same_day_repeat: Thu: Aloo matar at Lunch and Dinner
- same_day_repeat: Fri: Bhindi at Lunch and Dinner
- planner said unmet: Bhindi at Lunch comes back sooner than usual (Tue, Fri); Wed Lunch: Kadhi chawal comes back sooner than usual; Thu Lunch: Aloo matar comes back sooner than usual

### h6-kulkarni
- repeat_window: Breakfast (window 3): Upma Mon and Tue; Sheera Wed and Thu
- repeat_window: Dinner (window 2): Pithla Tue and Wed; Usal Thu and Fri; Usal Fri and Sat
- repeat_window: Snack box (window 3): Idli Tue and Wed
- planner said unmet: Wed Snack box: Idli comes back sooner than usual; Upma at Breakfast comes back sooner than usual (Tue, Fri); Sheera at Breakfast comes back sooner than usual (Thu, Sun)

### h7-menon
- default_cap: Paneer (no frequency, not a staple) on 3 days: Tue Dinner, Wed Lunch, Sun Dinner
- planner said unmet: Wed Lunch: Paneer comes back sooner than usual

### h8-banerjee
- planner said unmet: Maacher jhol at Lunch comes back sooner than usual (Sat, Sun)

## Top failure kinds

- default_cap: 7
- planner said unmet: 6
- repeat_window: 5
- same_day_repeat: 4
- dish_frequency: 1
- soft_frequency: 1
