# Eval 2 (plan, truth) — 2026-11-23T19:09

week 2026-11-30; model deepseek/deepseek-v4-flash; judges off; 7.3 min; spend $0.067 (227 calls)

| run | filled | attendance | skips_kept | no_stray | hard_rules | from_library | new_budget | default_cap | dish_frequency | repeat_window | same_day_repeat | guests | soft_frequency | cap_rules | guest_rules | daily_dishes | hard_breaks | new_dishes | family_dish_share | unmet | flagged |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| h1-sharma | 25/25 | 25/25 | 1/1 | 1/1 | 1/1 | 59/59 | 1/1 | 14/14 | 5/5 | 4/4 | 6/7 | – | – | – | – | – | 0 | 0 | 100 | 1 | 1 |
| h2-iyer | 20/20 | 20/20 | 1/1 | 1/1 | 3/3 | 62/62 | 1/1 | 13/13 | 6/6 | 3/3 | 7/7 | 1/1 | – | – | – | – | 0 | 0 | 100 | 0 | 0 |
| h3-shiva | 30/30 | 30/30 | 3/3 | 1/1 | 7/7 | 60/60 | 1/1 | 16/17 | 7/7 | 3/5 | 5/7 | – | 0/1 | 6/6 | – | – | 0 | 1 | 97 | 5 | 1 |
| h4-reddy | 40/40 | 40/40 | – | 1/1 | 4/4 | 90/90 | 1/1 | 16/21 | 2/2 | 4/6 | 7/7 | – | 0/1 | – | – | – | 0 | 2 | 100 | 2 | 1 |
| h5-agarwal | 26/26 | 26/26 | – | 1/1 | 4/4 | 51/51 | 1/1 | 11/11 | 3/3 | 4/4 | 6/7 | – | – | – | – | – | 0 | 1 | 98 | 3 | 1 |
| h6-kulkarni | 26/26 | 26/26 | – | 1/1 | 2/2 | 58/58 | 1/1 | 12/12 | 5/5 | 2/4 | 7/7 | 1/1 | – | – | 1/1 | – | 0 | 2 | 98 | 5 | 1 |
| h7-menon | 18/18 | 18/18 | 3/3 | 1/1 | 1/1 | 52/52 | 1/1 | 9/9 | 2/3 | 3/3 | 7/7 | – | – | – | – | 7/7 | 0 | 0 | 100 | 1 | 1 |
| h8-banerjee | 26/26 | 26/26 | – | 1/1 | 4/4 | 71/71 | 1/1 | 12/12 | 5/5 | 4/4 | 7/7 | – | – | – | – | – | 0 | 0 | 100 | 4 | 1 |
| **total** | 100% (211/211) | 100% (211/211) | 100% (8/8) | 100% (8/8) | 100% (26/26) | 100% (503/503) | 100% (8/8) | 94% (103/109) | 97% (35/36) | 82% (27/33) | 93% (52/56) | 100% (2/2) | 0% (0/2) | 100% (6/6) | 100% (1/1) | 100% (7/7) |  |  |  |  |  |

Tracked, not gating (shape: dish count per slot-day within ±1 of the slot's history):

| run | shape |
|---|---|
| h1-sharma | 23/25 |
| h2-iyer | 20/20 |
| h3-shiva | 29/30 |
| h4-reddy | 39/40 |
| h5-agarwal | 25/26 |
| h6-kulkarni | 26/26 |
| h7-menon | 18/18 |
| h8-banerjee | 26/26 |
| **total** | 98% (206/211) |

## Misses

### h1-sharma
- same_day_repeat: Thu: Lauki at Lunch and Dinner
- planner said unmet: Thu Lunch: Lauki comes back sooner than usual

### h3-shiva
- default_cap: Phulka (no frequency, not a staple) on 6 days: Mon Gowri Shankar's dinner, Tue Gowri Shankar's dinner, Wed Gowri Shankar's dinner, Thu Gowri Shankar's dinner, Fri Gowri Shankar's dinner, Sun Gowri Shankar's dinner
- repeat_window: Lunch (window 2): Rajma chawal Mon and Tue
- repeat_window: Gowri Shankar's dinner (window 3): Phulka Mon and Tue; Phulka Tue and Wed; Phulka Wed and Thu; Phulka Thu and Fri; Phulka Fri and Sun
- same_day_repeat: Thu: Bhindi at Lunch and Dinner
- same_day_repeat: Fri: Aloo gobi at Lunch and Dinner
- soft_frequency: millets are good for Gowri Shankar: 7 times (want 2–3)
- planner said unmet: Tue Lunch: Rajma chawal comes back sooner than usual; Thu Lunch: Dal comes back sooner than usual; Thu Lunch: Bhindi comes back sooner than usual; Fri Lunch: Sambar comes back sooner than usual; Fri Lunch: Aloo gobi comes back sooner than usual

### h4-reddy
- default_cap: Dosa (no frequency, not a staple) on 3 days: Tue Breakfast, Fri Sarojini's breakfast, Sat Breakfast
- default_cap: Ragi dosa (no frequency, not a staple) on 3 days: Mon Sarojini's breakfast, Wed Sarojini's breakfast, Sun Sarojini's breakfast
- default_cap: Dondakaya curry (no frequency, not a staple) on 5 days: Mon Lunch, Tue Dinner, Thu Lunch, Fri Dinner, Sun Lunch
- default_cap: Beans curry (no frequency, not a staple) on 4 days: Mon Dinner, Tue Lunch, Thu Dinner, Fri Lunch
- default_cap: Jowar roti (no frequency, not a staple) on 7 days: Mon Sarojini's dinner, Tue Sarojini's dinner, Wed Sarojini's dinner, Thu Sarojini's dinner, Fri Sarojini's dinner, Sat Sarojini's dinner, Sun Sarojini's dinner
- repeat_window: Sarojini's breakfast (window 3): Ragi dosa Mon and Wed
- repeat_window: Sarojini's dinner (window 3): Jowar roti Mon and Tue; Jowar roti Tue and Wed; Jowar roti Wed and Thu; Jowar roti Thu and Fri; Jowar roti Fri and Sat; Jowar roti Sat and Sun
- soft_frequency: ragi is good for Sarojini, a few times a week: 15 times (want 2–3)
- planner said unmet: Dondakaya curry at Lunch comes back sooner than usual (Mon, Thu, Sun); Beans curry at Lunch comes back sooner than usual (Tue, Fri)

### h5-agarwal
- same_day_repeat: Fri: Bhindi at Lunch and Dinner
- planner said unmet: Bhindi at Lunch comes back sooner than usual (Tue, Fri); Wed Lunch: Aloo matar comes back sooner than usual; Sat Lunch: Kadhi chawal comes back sooner than usual

### h6-kulkarni
- repeat_window: Dinner (window 2): Pithla Tue and Wed
- repeat_window: Snack box (window 3): Idli Tue and Wed
- planner said unmet: Wed Snack box: Idli comes back sooner than usual; Pithla at Dinner comes back sooner than usual (Wed, Fri, Sun); Fri Dinner: Bhakri comes back sooner than usual; Sat Dinner: Usal comes back sooner than usual; Sun Dinner: Poli comes back sooner than usual

### h7-menon
- dish_frequency: Dal (sometimes) on Tue Lunch, Wed Dinner, Fri Lunch, Sun Dinner
- planner said unmet: Sun Dinner: Dal comes back sooner than usual

### h8-banerjee
- planner said unmet: Maacher jhol at Lunch comes back sooner than usual (Sat, Sun); Dal at Dinner comes back sooner than usual (Tue, Wed, Thu, Fri, Sat, Sun); Torkari at Dinner comes back sooner than usual (Tue, Wed, Thu, Fri, Sat, Sun); Roti at Dinner comes back sooner than usual (Fri, Sun)

## Top failure kinds

- planner said unmet: 7
- default_cap: 6
- repeat_window: 6
- same_day_repeat: 4
- soft_frequency: 2
- dish_frequency: 1
