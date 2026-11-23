# Eval 2 (plan, truth, held-out) — 2026-11-23T19:08

week 2026-11-30; model deepseek/deepseek-v4-flash; judges anthropic/claude-sonnet-5.5 + openai/gpt-5; 6.5 min; spend $0.372 (81 calls)

| run | filled | attendance | skips_kept | no_stray | hard_rules | from_library | new_budget | default_cap | dish_frequency | daily_dishes | repeat_window | same_day_repeat | guests | soft_frequency | hard_breaks | new_dishes | family_dish_share | unmet | flagged | judge_fits_dishes | judge_meal_shape | judge_variety | judge_per_person | judge_overall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| h9-mehta | 27/27 | 27/27 | 1/1 | 1/1 | 1/1 | 58/58 | 1/1 | 9/10 | 2/4 | 7/7 | 3/4 | 4/7 | – | – | 0 | 1 | 100 | 10 | 1 | 4.5 | 4 | 2.5 | 5 | 3.5 |
| h10-qureshi | 24/24 | 24/24 | 1/1 | 1/1 | 3/3 | 44/44 | 1/1 | 7/13 | 2/3 | – | 2/4 | 7/7 | 1/1 | – | 0 | 0 | 100 | 7 | 1 | 4 | 2 | 2 | 4 | 2.5 |
| h11-dsouza | 20/20 | 20/20 | 1/1 | 1/1 | 2/2 | 54/54 | 1/1 | 9/9 | 6/6 | – | 3/3 | 7/7 | – | 0/1 | 0 | 0 | 100 | 0 | 0 | 4.5 | 4.5 | 3.5 | 4 | 4 |
| h12-sen | 35/35 | 35/35 | – | 1/1 | 5/5 | 75/75 | 1/1 | 3/12 | 5/5 | – | 4/6 | 5/7 | – | – | 0 | 2 | 97 | 7 | 1 | 3 | 3 | 3 | 3 | 3 |
| **total** | 100% (106/106) | 100% (106/106) | 100% (3/3) | 100% (4/4) | 100% (11/11) | 100% (231/231) | 100% (4/4) | 64% (28/44) | 83% (15/18) | 100% (7/7) | 71% (12/17) | 82% (23/28) | 100% (1/1) | 0% (0/1) |  |  |  |  |  |  |  |  |  |  |

Judges' average: fits_dishes 4.0, meal_shape 3.4, variety 2.8, per_person 4.0, overall 3.3

Tracked, not gating (shape: dish count per slot-day within ±1 of the slot's history):

| run | shape |
|---|---|
| h9-mehta | 26/27 |
| h10-qureshi | 20/24 |
| h11-dsouza | 18/20 |
| h12-sen | 35/35 |
| **total** | 93% (99/106) |

## Misses

### h9-mehta
- default_cap: Thepla (no frequency, not a staple) on 4 days: Tue Breakfast, Tue Ba's dinner, Thu Ba's dinner, Fri Breakfast, Fri Dinner, Sat Breakfast, Sat Ba's dinner
- dish_frequency: Kadhi (sometimes) on Mon Dinner, Tue Lunch, Wed Lunch, Thu Dinner, Fri Lunch, Sat Dinner
- dish_frequency: Khichdi (2/week) on Mon Ba's dinner, Mon Dinner, Wed Ba's dinner, Wed Dinner, Fri Ba's dinner, Sat Dinner, Sun Ba's dinner
- repeat_window: Lunch (window 2): Kadhi Tue and Wed; Cabbage shaak Wed and Thu
- same_day_repeat: Tue: Bhindi shaak at Lunch and Dinner
- same_day_repeat: Wed: Cabbage shaak at Lunch and Dinner
- same_day_repeat: Fri: Bhindi shaak at Lunch and Dinner
- judge: Kadhi appears five days (3 at lunch, 3 at dinner counting overlaps) and dinner khichdi 3 times, exceeding the 2/week limits; Bhindi and Cabbage repeat same day. | Too much kadhi and khichdi at dinners (3 each vs 2/week), and bhindi/cabbage repeat at lunch and dinner on the same day.
- planner said unmet: Khichdi at Ba's dinner comes back sooner than usual (Fri, Sun); Sat Ba's dinner: Thepla comes back sooner than usual; Wed Lunch: Kadhi comes back sooner than usual; Thu Lunch: Cabbage shaak comes back sooner than usual; Sat Lunch: Dal comes back sooner than usual; Kadhi at Dinner comes back sooner than usual (Mon, Thu, Sat); Bhindi shaak at Dinner comes back sooner than usual (Tue, Fri); Wed Dinner: Cabbage shaak comes back sooner than usual; Fri Dinner: Thepla comes back sooner than usual; Sat Dinner: Khichdi comes back sooner than usual

### h10-qureshi
- default_cap: Dal chawal (no frequency, not a staple) on 3 days: Mon Lunch, Fri Lunch, Sat Lunch
- default_cap: Roti (no frequency, not a staple) on 4 days: Mon Lunch, Fri Lunch, Sat Lunch, Sun Lunch
- default_cap: Sabzi (no frequency, not a staple) on 3 days: Tue Dinner, Fri Dinner, Sat Lunch
- default_cap: Khichdi (no frequency, not a staple) on 3 days: Mon Zayan's dinner, Mon Lunch, Thu Zayan's dinner, Sun Zayan's dinner, Sun Lunch
- default_cap: Chicken curry (no frequency, not a staple) on 3 days: Mon Dinner, Thu Dinner, Sun Dinner
- default_cap: Dal (no frequency, not a staple) on 3 days: Mon Dinner, Thu Dinner, Fri Dinner
- dish_frequency: Mutton curry (rarely) on Tue Dinner, Wed Dinner, Sun Dinner
- repeat_window: Lunch (window 3): Dal chawal Fri and Sat; Roti Fri and Sat; Roti Sat and Sun
- repeat_window: Dinner (window 3): Mutton curry Tue and Wed; Dal Thu and Fri
- judge: Mutton curry (rare) appears three times, and doubled with fish or chicken curry. Fri lunch has dal chawal plus dal rice, and Mon lunch pairs dal chawal with khichdi. | Mutton curry appears three times this week despite being a 'rarely' dish.
- planner said unmet: Sun Zayan's dinner: Khichdi comes back sooner than usual; Mutton curry at Dinner comes back sooner than usual (Wed, Sun); Fri Dinner: Dal comes back sooner than usual; Sun Dinner: Chicken curry comes back sooner than usual; Sat Lunch: Dal chawal comes back sooner than usual; Roti at Lunch comes back sooner than usual (Sat, Sun); Sat Lunch: Sabzi comes back sooner than usual

### h11-dsouza
- soft_frequency: millets three times a week for Vikram: 1 times (want 2–3)
- judge: Overnight oats twice (Mon, Fri) though only 'sometimes', and millets (ragi) appear only once, short of Vikram's three a week; Poha and Besan chilla barely rotate. | Vikram’s millet preference missed: only one millet meal instead of three for the week.

### h12-sen
- default_cap: Poha (no frequency, not a staple) on 4 days: Mon Breakfast, Thu Breakfast, Fri Breakfast, Sat Breakfast
- default_cap: Besan chilla (no frequency, not a staple) on 4 days: Mon Breakfast, Tue Breakfast, Wed Breakfast, Sat Breakfast
- default_cap: Toast (no frequency, not a staple) on 4 days: Tue Breakfast, Wed Breakfast, Thu Breakfast, Fri Breakfast
- default_cap: Dal (no frequency, not a staple) on 7 days: Mon Dinner, Tue Dinner, Wed Dinner, Thu Dinner, Fri Dinner, Sat Dinner, Sun Dinner
- default_cap: Aloo posto (no frequency, not a staple) on 5 days: Mon Dinner, Wed Lunch, Wed Dinner, Fri Dinner, Sat Lunch, Sun Dinner
- default_cap: Gatte ki sabzi (no frequency, not a staple) on 4 days: Tue Lunch, Tue Dinner, Thu Dinner, Fri Lunch, Sat Dinner
- default_cap: Roti (no frequency, not a staple) on 7 days: Mon Dinner, Tue Dinner, Wed Dinner, Thu Dinner, Fri Dinner, Sat Dinner, Sun Dinner
- default_cap: Bajra roti (no frequency, not a staple) on 4 days: Mon Papaji's dinner, Wed Papaji's dinner, Fri Papaji's dinner, Sun Papaji's dinner
- default_cap: Jowar roti (no frequency, not a staple) on 3 days: Tue Papaji's dinner, Thu Papaji's dinner, Sat Papaji's dinner
- repeat_window: Breakfast (window 3): Besan chilla Mon and Tue; Besan chilla Tue and Wed; Toast Tue and Wed; Toast Wed and Thu; Poha Thu and Fri; Toast Thu and Fri; Poha Fri and Sat
- repeat_window: Papaji's dinner (window 3): Bajra roti Mon and Wed; Jowar roti Tue and Thu; Bajra roti Wed and Fri; Jowar roti Thu and Sat; Bajra roti Fri and Sun
- same_day_repeat: Tue: Gatte ki sabzi at Lunch and Dinner
- same_day_repeat: Wed: Aloo posto at Lunch and Dinner
- judge: Mili's tiffin uses dishes outside their list (Veggie wrap, Noodles), and Wed/Sat lunch drops dal. Fish appears only twice, but Shefali's presence is handled inconsistently.
- planner said unmet: Aloo posto at Dinner comes back sooner than usual (Mon, Wed, Fri, Sun); Roti at Dinner comes back sooner than usual (Tue, Wed, Thu, Fri, Sat, Sun); Dal at Dinner comes back sooner than usual (Tue, Wed, Thu, Fri, Sat, Sun); Gatte ki sabzi at Dinner comes back sooner than usual (Tue, Thu, Sat); Besan chilla at Breakfast comes back sooner than usual (Tue, Wed, Sat); Toast at Breakfast comes back sooner than usual (Wed, Thu, Fri); Poha at Breakfast comes back sooner than usual (Fri, Sat)

## Top failure kinds

- default_cap: 16
- repeat_window: 5
- same_day_repeat: 5
- judge: 4
- dish_frequency: 3
- planner said unmet: 3
- soft_frequency: 1
