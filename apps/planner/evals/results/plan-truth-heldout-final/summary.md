# Eval 2 (plan, truth, held-out) — 2026-11-23T17:23

week 2026-11-30; model deepseek/deepseek-v4-flash; judges anthropic/claude-sonnet-5.5 + openai/gpt-5; 9.8 min; spend $0.462 (92 calls)

| run | filled | attendance | skips_kept | no_stray | hard_rules | from_library | new_budget | default_cap | dish_frequency | daily_dishes | repeat_window | same_day_repeat | guests | soft_frequency | hard_breaks | new_dishes | family_dish_share | unmet | flagged | judge_fits_dishes | judge_meal_shape | judge_variety | judge_per_person | judge_overall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| h9-mehta | 27/27 | 27/27 | 1/1 | 1/1 | 1/1 | 52/52 | 1/1 | 9/10 | 3/4 | 7/7 | 1/4 | 7/7 | – | – | 0 | 0 | 100 | 3 | 1 | 4.5 | 1.5 | 1.5 | 5 | 2.5 |
| h10-qureshi | 24/24 | 24/24 | 1/1 | 1/1 | 3/3 | 34/34 | 1/1 | 13/14 | 3/3 | – | 3/4 | 7/7 | 1/1 | – | 0 | 1 | 97 | 1 | 1 | 3.5 | 2.5 | 4 | 1.5 | 2 |
| h11-dsouza | 20/20 | 20/20 | 1/1 | 1/1 | 2/2 | 54/54 | 1/1 | 8/8 | 6/6 | – | 3/3 | 7/7 | – | 1/1 | 0 | 1 | 98 | 0 | 0 | 4 | 4 | 4 | 3.5 | 3.5 |
| h12-sen | 40/40 | 40/40 | – | 1/1 | 5/5 | 72/72 | 1/1 | 9/12 | 4/5 | – | 4/6 | 7/7 | – | – | 0 | 0 | 100 | 9 | 1 | 4.5 | 4.5 | 1.5 | 4 | 3 |
| **total** | 100% (111/111) | 100% (111/111) | 100% (3/3) | 100% (4/4) | 100% (11/11) | 100% (212/212) | 100% (4/4) | 89% (39/44) | 89% (16/18) | 100% (7/7) | 65% (11/17) | 100% (28/28) | 100% (1/1) | 100% (1/1) |  |  |  |  |  |  |  |  |  |  |

Judges' average: fits_dishes 4.1, meal_shape 3.1, variety 2.8, per_person 3.5, overall 2.8

Tracked, not gating (shape: dish count per slot-day within ±1 of the slot's history):

| run | shape |
|---|---|
| h9-mehta | 26/27 |
| h10-qureshi | 23/24 |
| h11-dsouza | 18/20 |
| h12-sen | 40/40 |
| **total** | 96% (107/111) |

## Misses

### h9-mehta
- dish_frequency: Khichdi (2/week) on Mon Ba's dinner, Tue Ba's dinner, Wed Ba's dinner, Thu Ba's dinner, Fri Ba's dinner, Sat Ba's dinner, Sun Ba's dinner
- default_cap: Bhakri (no frequency, not a staple) on 6 days: Mon Dinner, Tue Dinner, Wed Dinner, Thu Dinner, Fri Dinner, Sat Dinner
- repeat_window: Lunch (window 2): Dal Mon and Tue
- repeat_window: Dinner (window 2): Bhakri Mon and Tue; Bhakri Tue and Wed; Bhakri Wed and Thu; Bhakri Thu and Fri; Bhakri Fri and Sat
- repeat_window: Ba's dinner (window 2): Khichdi Mon and Tue; Khichdi Tue and Wed; Khichdi Wed and Thu; Khichdi Thu and Fri; Khichdi Fri and Sat; Khichdi Sat and Sun
- judge: Dinner is plain Bhakri alone six nights, with no shaak, and no Khichdi, Kadhi or Thepla at dinner, so there is no variety. | All dinners are just bhakri without shaak or khichdi/kadhi, unlike their usual dinners; dinner shape and variety are missing.
- planner said unmet: only 2 Ba's dinner dishes known, so some come back more often than usual; only 6 Lunch dishes known, so some come back more often than usual; only 7 Dinner dishes known, so some come back more often than usual

### h10-qureshi
- default_cap: Dal rice (no frequency, not a staple) on 3 days: Tue Zayan's dinner, Fri Zayan's dinner, Sun Zayan's dinner
- repeat_window: Zayan's dinner (window 3): Dal rice Fri and Sun
- judge: Zayan's dinner on Sunday has a vegetable biryani he cannot eat. Many 'no X for Zayan' notes on dishes he normally eats, such as 'no rice for Zayan' on dal chawal, make little sense. | Zayan is wrongly excluded from 'for everyone' meals (Mon breakfast; Mon/Fri lunch) by banning rice/dal/atta, leaving the toddler without food at those slots.
- planner said unmet: Sun Zayan's dinner: Dal rice comes back sooner than usual

### h11-dsouza
- judge: Ragi malt is not one of their dishes, and ghee/dairy notes for Ishita are applied inconsistently, with overnight oats twice. | Sunday breakfast ragi malt isn’t in their dishes; swap to ragi dosa or besan chilla.

### h12-sen
- default_cap: Aloo posto (no frequency, not a staple) on 6 days: Mon Lunch, Tue Dinner, Wed Dinner, Thu Lunch, Fri Dinner, Sat Dinner
- default_cap: Gatte ki sabzi (no frequency, not a staple) on 5 days: Mon Dinner, Tue Lunch, Wed Dinner, Thu Dinner, Fri Lunch
- default_cap: Roti (no frequency, not a staple) on 7 days: Mon Dinner, Tue Dinner, Wed Dinner, Thu Dinner, Fri Dinner, Sat Dinner, Sun Dinner
- dish_frequency: Macher jhol (2/week) on Mon Debjani and Mili's fish, Tue Debjani and Mili's fish, Wed Debjani and Mili's fish, Thu Debjani and Mili's fish, Fri Debjani and Mili's fish, Sat Debjani and Mili's fish, Sun Debjani and Mili's fish
- repeat_window: Mili's tiffin (window 2): Paratha roll Tue and Wed
- repeat_window: Debjani and Mili's fish (window 2): Macher jhol Mon and Tue; Macher jhol Tue and Wed; Macher jhol Wed and Thu; Macher jhol Thu and Fri; Macher jhol Fri and Sat; Macher jhol Sat and Sun
- judge: Macher jhol is planned all 7 days instead of the family's twice a week. | Macher jhol given every night; Debjani and Mili only have it twice a week.
- planner said unmet: only 4 Dinner dishes known, so some come back more often than usual; only 1 Debjani and Mili's fish dish known, so some come back more often than usual; only 2 Papaji's dinner dishes known, so some come back more often than usual; Wed Mili's tiffin: Paratha roll comes back sooner than usual; Wed Debjani and Mili's fish: no known dish fits everyone there; Thu Debjani and Mili's fish: no known dish fits everyone there; Fri Debjani and Mili's fish: no known dish fits everyone there; Sat Debjani and Mili's fish: no known dish fits everyone there; Sun Debjani and Mili's fish: no known dish fits everyone there

## Top failure kinds

- repeat_window: 6
- default_cap: 5
- judge: 4
- planner said unmet: 3
- dish_frequency: 2
