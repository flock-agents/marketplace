# Eval 2 (plan, truth) — 2026-11-23T16:14

week 2026-11-30; model deepseek/deepseek-v4-flash; judges anthropic/claude-sonnet-5.5 + openai/gpt-5; 11.8 min; spend $0.801 (176 calls)

| run | filled | attendance | skips_kept | no_stray | hard_rules | from_library | new_budget | default_cap | dish_frequency | repeat_window | same_day_repeat | guests | soft_frequency | cap_rules | guest_rules | daily_dishes | hard_breaks | new_dishes | family_dish_share | unmet | flagged | judge_fits_dishes | judge_meal_shape | judge_variety | judge_per_person | judge_overall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| h1-sharma | 25/25 | 25/25 | 1/1 | 1/1 | 1/1 | 56/56 | 1/1 | 13/14 | 3/5 | 4/4 | 7/7 | – | – | – | – | – | 0 | 0 | 100 | 2 | 1 | 5 | 4.5 | 3.5 | 5 | 4 |
| h2-iyer | 20/20 | 20/20 | 1/1 | 1/1 | 3/3 | 63/63 | 1/1 | 13/13 | 2/6 | 3/3 | 7/7 | 0/1 | – | – | – | – | 0 | 0 | 100 | 0 | 0 | 5 | 3 | 4 | 2.5 | 3 |
| h3-shiva | 30/30 | 30/30 | 2/3 | 0/1 | 7/7 | 57/57 | 1/1 | 18/18 | 6/7 | 5/5 | 7/7 | – | 1/1 | 6/6 | – | – | 0 | 0 | 100 | 1 | 1 | 3.5 | 2 | 3 | 4 | 2.5 |
| h4-reddy | 40/40 | 30/40 | – | 1/1 | 4/4 | 82/94 | 1/1 | 17/21 | 1/2 | 5/6 | 7/7 | – | 0/1 | – | – | – | 0 | 0 | 100 | 7 | 1 | 3.5 | 2 | 2 | 2 | 2 |
| h5-agarwal | 26/26 | 21/26 | – | 1/1 | 4/4 | 53/53 | 1/1 | 8/11 | 3/3 | 3/4 | 7/7 | – | – | – | – | – | 0 | 0 | 100 | 1 | 1 | 4 | 2 | 2.5 | 1.5 | 2 |
| h6-kulkarni | 26/26 | 26/26 | – | 1/1 | 1/2 | 57/57 | 1/1 | 7/12 | 4/5 | 2/4 | 7/7 | 0/1 | – | – | 1/1 | – | 6 | 0 | 100 | 4 | 1 | 4 | 4 | 2 | 2 | 2.5 |
| h7-menon | 13/18 | 13/13 | 3/3 | 1/1 | 1/1 | 37/37 | 1/1 | 9/9 | 3/3 | 3/3 | 7/7 | – | – | – | – | 7/7 | 0 | 1 | 97 | 0 | 0 | 2.5 | 1.5 | 2.5 | 1 | 1 |
| h8-banerjee | 33/33 | 28/33 | – | 1/1 | 3/4 | 85/85 | 1/1 | 9/13 | 4/5 | 3/5 | 7/7 | – | – | – | – | – | 6 | 0 | 100 | 7 | 1 | 4 | 2.5 | 2.5 | 2.5 | 2.5 |
| **total** | 98% (213/218) | 91% (193/213) | 88% (7/8) | 88% (7/8) | 92% (24/26) | 98% (490/502) | 100% (8/8) | 85% (94/111) | 72% (26/36) | 82% (28/34) | 100% (56/56) | 0% (0/2) | 50% (1/2) | 100% (6/6) | 100% (1/1) | 100% (7/7) |  |  |  |  |  |  |  |  |  |  |

Judges' average: fits_dishes 3.9, meal_shape 2.7, variety 2.8, per_person 2.6, overall 2.4

Tracked, not gating (shape: dish count per slot-day within ±1 of the slot's history):

| run | shape |
|---|---|
| h1-sharma | 23/25 |
| h2-iyer | 19/20 |
| h3-shiva | 27/31 |
| h4-reddy | 40/40 |
| h5-agarwal | 25/26 |
| h6-kulkarni | 26/26 |
| h7-menon | 13/13 |
| h8-banerjee | 28/33 |
| **total** | 94% (201/214) |

## Misses

### h1-sharma
- default_cap: Poha (no frequency, not a staple) on 3 days: Mon Breakfast, Wed Vihaan's tiffin, Thu Breakfast
- dish_frequency: Cornflakes (sometimes) on Sun Breakfast
- dish_frequency: Maggi (Fri) on Thu Vihaan's tiffin
- judge: No chicken curry on Sat or Sun and no non-veg at all; Thursday dinner is just Roti, Dal, thinner than past dinners. | Maggi scheduled Thursday for Vihaan’s tiffin; family keeps Maggi to Friday only.
- planner said unmet: Wed Vihaan's tiffin: no known dish fits everyone there; Thu Vihaan's tiffin: no known dish fits everyone there

### h2-iyer
- refused while loading: set_slot_day Sun Lunch: TypeError: agentOps(() => hono)[name] is not a function. (In 'agentOps(() => hono)[name](payload, { agentId })', 'agentO
- guests: Sun Lunch: guests [] (want 2)
- dish_frequency: Ragi porridge (sometimes) on Thu Breakfast
- dish_frequency: Kootu (sometimes) on Sun Lunch
- dish_frequency: Uthappam (sometimes) on Wed Dinner
- dish_frequency: Rasam rice (sometimes) on Thu Dinner
- judge: Wednesday breakfast is only coconut chutney with no idli, dosa or upma. The Sunday lunch guests are not listed, so the meal isn't planned for them. | Sunday lunch omits the two guests; only the family listed.

### h3-shiva
- skips_kept: Sat Gowri Shankar's dinner: has dishes though ordered_in
- no_stray: Sat Gowri Shankar's dinner
- dish_frequency: Curd rice (sometimes) on no day
- judge: Friday lunch pairs Rice, Sambar and Rajma chawal, Friday dinner is only Chapati, and Thursday notes mention leftover 'millet rice' text, so the plan has visible errors. | Lunches break the cook's two-dish limit and are oddly combined, e.g., Fri has Rice+Sambar+Curd+Rajma chawal; Sat has Rice+Curd with Bisi bele bath.
- planner said unmet: only 0 Gowri Shankar's dinner dishes known, so some come back more often than usual

### h4-reddy
- attendance: Mon Breakfast: for ["Srinivas","Padma","Sarojini","Venkat"] (want ["Srinivas","Padma","Karan","Sarojini","Venkat"])
- attendance: Tue Breakfast: for ["Srinivas","Padma","Sarojini","Venkat"] (want ["Srinivas","Padma","Karan","Sarojini","Venkat"])
- attendance: Wed Breakfast: for ["Padma","Sarojini","Venkat"] (want ["Padma","Karan","Sarojini","Venkat"])
- attendance: Thu Breakfast: for ["Padma","Sarojini","Venkat"] (want ["Padma","Karan","Sarojini","Venkat"])
- attendance: Fri Breakfast: for ["Srinivas","Padma","Sarojini","Venkat"] (want ["Srinivas","Padma","Karan","Sarojini","Venkat"])
- attendance: Mon Lunch: for ["Sarojini","Venkat"] (want ["Srinivas","Padma","Sarojini","Venkat"])
- attendance: Tue Lunch: for ["Sarojini","Venkat"] (want ["Srinivas","Padma","Sarojini","Venkat"])
- attendance: Wed Lunch: for ["Sarojini","Venkat"] (want ["Padma","Sarojini","Venkat"])
- attendance: Thu Lunch: for ["Sarojini","Venkat"] (want ["Padma","Sarojini","Venkat"])
- attendance: Fri Lunch: for ["Sarojini","Venkat"] (want ["Srinivas","Padma","Sarojini","Venkat"])
- from_library: Tue Sarojini's breakfast: Idli is not in Sarojini's breakfast's library
- from_library: Tue Sarojini's breakfast: Allam chutney is not in Sarojini's breakfast's library
- from_library: Wed Sarojini's breakfast: Upma is not in Sarojini's breakfast's library
- from_library: Wed Sarojini's breakfast: Allam chutney is not in Sarojini's breakfast's library
- from_library: Thu Sarojini's breakfast: Pesarattu is not in Sarojini's breakfast's library
- from_library: Thu Sarojini's breakfast: Allam chutney is not in Sarojini's breakfast's library
- from_library: Fri Sarojini's breakfast: Idli is not in Sarojini's breakfast's library
- from_library: Fri Sarojini's breakfast: Allam chutney is not in Sarojini's breakfast's library
- from_library: Sat Sarojini's breakfast: Dosa is not in Sarojini's breakfast's library
- from_library: Sat Sarojini's breakfast: Allam chutney is not in Sarojini's breakfast's library
- from_library: Sun Sarojini's breakfast: Upma is not in Sarojini's breakfast's library
- from_library: Sun Sarojini's breakfast: Allam chutney is not in Sarojini's breakfast's library
- default_cap: Idli (no frequency, not a staple) on 3 days: Mon Breakfast, Tue Sarojini's breakfast, Fri Breakfast, Fri Sarojini's breakfast
- default_cap: Allam chutney (no frequency, not a staple) on 6 days: Tue Sarojini's breakfast, Wed Sarojini's breakfast, Thu Sarojini's breakfast, Fri Sarojini's breakfast, Sat Sarojini's breakfast, Sun Sarojini's breakfast
- dish_frequency: Bread toast (sometimes) on no day
- default_cap: Rice (no frequency, not a staple) on 3 days: Mon Dinner, Thu Dinner, Sun Dinner
- default_cap: Pappu (no frequency, not a staple) on 3 days: Mon Dinner, Thu Dinner, Sun Dinner
- repeat_window: Sarojini's breakfast (window 3): Allam chutney Tue and Wed; Allam chutney Wed and Thu; Allam chutney Thu and Fri; Allam chutney Fri and Sat; Allam chutney Sat and Sun
- soft_frequency: ragi is good for Sarojini, a few times a week: 8 times (want 2–3)
- judge: Lunch omits Srinivas, Padma and Karan on weekdays, and Sunday has no chicken. Sarojini's ragi breakfast appears only on Monday, with plain breakfast repeats on other days. | Sunday lunch omits the expected chicken curry for non-veg family members.
- planner said unmet: only 0 Sarojini's dinner dishes known, so some come back more often than usual; Tue Sarojini's breakfast: no known dish fits everyone there; Wed Sarojini's breakfast: no known dish fits everyone there; Thu Sarojini's breakfast: no known dish fits everyone there; Fri Sarojini's breakfast: no known dish fits everyone there; Sat Sarojini's breakfast: no known dish fits everyone there; Sun Sarojini's breakfast: no known dish fits everyone there

### h5-agarwal
- attendance: Mon Breakfast: for ["Ankit","Pooja","Ramesh","Kamla"] (want ["Ankit","Pooja","Reyansh","Ramesh","Kamla"])
- attendance: Tue Breakfast: for ["Ankit","Pooja","Ramesh","Kamla"] (want ["Ankit","Pooja","Reyansh","Ramesh","Kamla"])
- attendance: Wed Breakfast: for ["Ankit","Pooja","Ramesh","Kamla"] (want ["Ankit","Pooja","Reyansh","Ramesh","Kamla"])
- attendance: Thu Breakfast: for ["Ankit","Pooja","Ramesh","Kamla","Sushila"] (want ["Ankit","Pooja","Reyansh","Ramesh","Kamla","Sushila"])
- attendance: Fri Breakfast: for ["Ankit","Pooja","Ramesh","Kamla","Sushila"] (want ["Ankit","Pooja","Reyansh","Ramesh","Kamla","Sushila"])
- default_cap: Poha (no frequency, not a staple) on 3 days: Tue Breakfast, Tue Reyansh's tiffin, Fri Breakfast, Fri Reyansh's tiffin, Sun Breakfast
- default_cap: Paratha (no frequency, not a staple) on 3 days: Mon Breakfast, Mon Reyansh's tiffin, Thu Breakfast, Thu Reyansh's tiffin, Sun Breakfast
- default_cap: Besan chilla (no frequency, not a staple) on 3 days: Mon Breakfast, Thu Breakfast, Sun Breakfast
- repeat_window: Breakfast (window 3): Poha Fri and Sun
- judge: Ramesh's garlic and Kamla's Tue/Sat onion-garlic rules are not kept, and Saturday dinner is missing khichdi, while Sunday dinner is roti only. | Ramesh’s no-onion/no-garlic rule isn’t consistently applied (especially Tue/Fri bhindi, Sat meals, kadhi), risking him being served garlic.
- planner said unmet: Sun Breakfast: no known dish fits everyone there

### h6-kulkarni
- refused while loading: set_slot_day Sat Dinner: TypeError: agentOps(() => hono)[name] is not a function. (In 'agentOps(() => hono)[name](payload, { agentId })', 'agentO
- guests: Sat Dinner: guests [] (want 4)
- hard_rules: Ishaan: no peanuts (allergy): Mon Lunch: Koshimbir has peanut (Ishaan); Tue Lunch: Koshimbir has peanut (Ishaan); Wed Lunch: Koshimbir has peanut (Ishaan); Fri Lunch: Koshimbir has peanut (Ishaan) (+2)
- default_cap: Upma (no frequency, not a staple) on 4 days: Mon Breakfast, Tue Breakfast, Thu Breakfast, Fri Breakfast
- default_cap: Poli (no frequency, not a staple) on 3 days: Tue Dinner, Thu Dinner, Sat Dinner
- dish_frequency: Amti (sometimes) on Wed Lunch
- default_cap: Bhakri (no frequency, not a staple) on 4 days: Mon Dinner, Wed Dinner, Fri Dinner, Sun Dinner
- default_cap: Usal (no frequency, not a staple) on 3 days: Mon Dinner, Thu Dinner, Fri Dinner
- default_cap: Pithla (no frequency, not a staple) on 4 days: Tue Dinner, Wed Dinner, Sat Dinner, Sun Dinner
- repeat_window: Breakfast (window 3): Upma Mon and Tue; Upma Tue and Thu; Upma Thu and Fri
- repeat_window: Dinner (window 3): Bhakri Mon and Wed; Pithla Tue and Wed; Poli Tue and Thu; Bhakri Wed and Fri; Usal Thu and Fri; Poli Thu and Sat; Bhakri Fri and Sun; Pithla Sat and Sun
- judge: Saturday dinner ignores the four vegetarian guests and drops fish fry; Sunday lunch also lacks chicken rassa. | Ishaan’s peanut allergy is inconsistently handled—koshimbir and likely cooking oil may include peanuts; notes are sporadic, making several meals unsafe.
- planner said unmet: only 5 Dinner dishes known, so some come back more often than usual; Tue Breakfast: no known dish fits everyone there; Thu Breakfast: no known dish fits everyone there; Fri Breakfast: no known dish fits everyone there

### h7-menon
- filled: Mon Dinner: no slot-day
- filled: Tue Dinner: no slot-day
- filled: Wed Dinner: no slot-day
- filled: Thu Dinner: no slot-day
- filled: Fri Dinner: no slot-day
- judge: Weekday dinners (Mon-Fri) are missing entirely, and Tanya is given invented exclusions (no eggs, rice, chicken, paneer) when her only rule is no red meat. | Weekday dinners are missing.

### h8-banerjee
- attendance: Mon Breakfast: for ["Sourav","Rituparna","Pradip","Gita"] (want ["Sourav","Rituparna","Riya","Pradip","Gita"])
- attendance: Tue Breakfast: for ["Sourav","Rituparna","Pradip","Gita"] (want ["Sourav","Rituparna","Riya","Pradip","Gita"])
- attendance: Wed Breakfast: for ["Sourav","Rituparna","Pradip","Gita"] (want ["Sourav","Rituparna","Riya","Pradip","Gita"])
- attendance: Thu Breakfast: for ["Sourav","Rituparna","Pradip","Gita"] (want ["Sourav","Rituparna","Riya","Pradip","Gita"])
- attendance: Fri Breakfast: for ["Sourav","Rituparna","Pradip","Gita"] (want ["Sourav","Rituparna","Riya","Pradip","Gita"])
- hard_rules: Gita: vegetarian, no fish, meat or eggs: Mon Breakfast: Egg has egg (Gita); Mon Lunch: Maacher jhol has fish (Gita); Tue Lunch: Maacher jhol has fish (Gita); Wed Lunch: Maacher jhol has fish (Gita) (+2)
- default_cap: Egg roll (no frequency, not a staple) on 5 days: Mon Riya's tiffin, Tue Riya's tiffin, Wed Riya's tiffin, Thu Riya's tiffin, Fri Riya's tiffin
- default_cap: Chowmein (no frequency, not a staple) on 5 days: Mon Riya's tiffin, Tue Riya's tiffin, Wed Riya's tiffin, Thu Riya's tiffin, Fri Riya's tiffin
- default_cap: Sandwich (no frequency, not a staple) on 5 days: Mon Riya's tiffin, Tue Riya's tiffin, Wed Riya's tiffin, Thu Riya's tiffin, Fri Riya's tiffin
- default_cap: Dal (no frequency, not a staple) on 7 days: Mon Dinner, Tue Dinner, Wed Dinner, Thu Dinner, Fri Dinner, Sat Dinner, Sun Dinner
- dish_frequency: Fish (sometimes) on no day
- repeat_window: Dinner (window 3): Dal Mon and Tue; Dal Tue and Wed; Dal Wed and Thu; Dal Thu and Fri; Dal Fri and Sat; Dal Sat and Sun
- repeat_window: Riya's tiffin (window 3): Chowmein Mon and Tue; Sandwich Mon and Tue; Egg roll Mon and Tue; Sandwich Tue and Wed; Egg roll Tue and Wed; Chowmein Tue and Wed; Egg roll Wed and Thu; Chowmein Wed and Thu; Sandwich Wed and Thu; Chowmein Thu and Fri; Sandwich Thu and Fri; Egg roll Thu and Fri
- judge: Sunday lacks Kosha mangsho, and Gita's no-garlic rule is missed on weekdays while Riya's tiffin lists all three items daily. | Sunday lunch lacks Kosha mangsho; breaks their Sunday mutton tradition.
- planner said unmet: only 1 Lunch dish known, so some come back more often than usual; only 2 Dinner dishes known, so some come back more often than usual; only 0 Gita's dinner dishes known, so some come back more often than usual; Tue Riya's tiffin: no known dish fits everyone there; Wed Riya's tiffin: no known dish fits everyone there; Thu Riya's tiffin: no known dish fits everyone there; Fri Riya's tiffin: no known dish fits everyone there

## Top failure kinds

- attendance: 20
- default_cap: 17
- from_library: 12
- dish_frequency: 10
- judge: 8
- planner said unmet: 6
- repeat_window: 6
- filled: 5
- refused while loading: 2
- guests: 2
- hard_rules: 2
- skips_kept: 1
- no_stray: 1
- soft_frequency: 1
