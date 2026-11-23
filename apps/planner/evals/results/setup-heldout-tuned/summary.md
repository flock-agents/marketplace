# Eval 1 (setup, held-out) — 2026-11-23T16:52

model deepseek/deepseek-v4-flash; persona deepseek/deepseek-v4-flash; repeat 2; 3.6 min; spend $0.049 (284 calls)

| run | slots_present | slot_kind | slot_people | slot_days | skip_days | no_extra_slots | lunch_unclear | cook_days | cook_times | placement | personal_placement | dish_frequency | rows_on_right_slot | no_unsaid_frequency | no_wrong_personal | hard_rules | soft_rules | hard_soft | no_unsaid_rules | hard_no_frequency | rule_quotes | noted | seed_present | seed_on_slot | family_cooks | rule_frequency |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| h9-mehta #1 | 4/4 | 4/4 | 3/4 | 4/4 | 4/4 | 1/1 | 1/1 | 1/1 | 1/1 | 16/18 | 0/2 | 3/5 | 19/19 | 14/14 | 1/1 | 0/1 | 1/1 | 1/1 | 1/1 | 3/3 | 5/5 | 1/1 | 3/4 | 15/15 | – | – |
| h9-mehta #2 | 3/4 | 3/3 | 2/3 | 3/3 | 3/3 | 1/1 | 1/1 | 1/1 | 1/1 | 16/18 | 0/2 | 5/5 | 16/16 | 11/11 | 1/1 | 1/1 | 1/1 | 2/2 | 1/1 | 4/4 | 6/6 | 1/1 | 3/4 | 12/12 | – | – |
| h10-qureshi #1 | 4/4 | 3/4 | 3/4 | 4/4 | 3/4 | 1/1 | 1/1 | 1/1 | 1/1 | 8/9 | 3/3 | – | 8/9 | 3/3 | 0/1 | 3/3 | 1/1 | 4/4 | 1/1 | 3/3 | 4/4 | 0/1 | 1/4 | 8/9 | 1/1 | – |
| h10-qureshi #2 | 3/4 | 3/3 | 2/3 | 3/3 | 3/3 | 1/1 | 1/1 | 1/1 | 1/1 | 18/21 | 0/3 | 2/3 | 19/22 | 13/16 | 1/1 | 3/3 | 1/1 | 4/4 | 0/1 | 4/4 | 5/5 | 1/1 | 3/4 | 19/22 | 1/1 | – |
| h11-dsouza #1 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 1/1 | 0/1 | 1/1 | – | 17/17 | – | 4/6 | 17/17 | 11/11 | 1/1 | 2/2 | 1/1 | 3/3 | 1/1 | 2/2 | 3/3 | – | 3/3 | 9/10 | 2/2 | 1/1 |
| h11-dsouza #2 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 1/1 | 0/1 | 1/1 | – | 16/16 | – | 1/5 | 16/16 | 11/11 | 1/1 | 2/2 | 1/1 | 3/3 | 1/1 | 2/2 | 3/3 | – | 3/3 | 11/12 | 2/2 | 1/1 |
| h12-sen #1 | 5/6 | 5/5 | 5/5 | 5/5 | 5/5 | 1/1 | 1/1 | 1/1 | 1/1 | 17/18 | 4/5 | 5/5 | 18/19 | 11/14 | 0/1 | 5/5 | 2/2 | 7/7 | 0/1 | 8/8 | 10/10 | – | 5/6 | 11/11 | 1/1 | – |
| h12-sen #2 | 5/6 | 5/5 | 5/5 | 5/5 | 5/5 | 1/1 | 1/1 | 1/1 | 1/1 | 18/19 | 5/6 | 3/5 | 19/25 | 15/15 | 0/6 | 5/5 | 2/2 | 7/7 | 1/1 | 9/9 | 11/11 | – | 5/6 | 12/15 | 1/1 | – |
| **total** | 88% (30/34) | 97% (29/30) | 87% (26/30) | 100% (30/30) | 97% (29/30) | 100% (8/8) | 75% (6/8) | 100% (8/8) | 100% (6/6) | 93% (126/136) | 57% (12/21) | 68% (23/34) | 92% (132/143) | 94% (89/95) | 38% (5/13) | 95% (21/22) | 100% (10/10) | 100% (31/31) | 75% (6/8) | 100% (35/35) | 100% (47/47) | 75% (3/4) | 76% (26/34) | 92% (97/106) | 100% (8/8) | 100% (2/2) |

Informational (not gating):

| run | dish_coverage |
|---|---|
| h9-mehta #1 | 14/15 |
| h9-mehta #2 | 14/15 |
| h10-qureshi #1 | 7/17 |
| h10-qureshi #2 | 17/17 |
| h11-dsouza #1 | 15/15 |
| h11-dsouza #2 | 14/15 |
| h12-sen #1 | 16/17 |
| h12-sen #2 | 17/17 |
| **total** | 89% (114/128) |

## Misses

### h9-mehta #1
- slot_people: Dinner for [] (want ["Hitesh","Bhavna","Dhruv"])
- placement: Thepla at Breakfast,Dinner (want Ba's dinner)
- personal_placement: Thepla (Ba's dinner's) saved at Breakfast,Dinner
- dish_frequency: Dhokla: saved {"frequency":null,"days":null} (want {"frequency":null,"days":["Sun"]})
- dish_frequency: Kadhi: saved {"frequency":null,"days":null} (want {"frequency":"sometimes","days":null})
- placement: Khichdi at Dinner (want Ba's dinner)
- personal_placement: Khichdi (Ba's dinner's) saved at Dinner
- hard_rules: missing: Jain: no onion, garlic, root vegetables, eggs or meat
- seed_present: no seed for Ba's dinner

### h9-mehta #2
- slot_people: Dinner for [] (want ["Hitesh","Bhavna","Dhruv"])
- slots_present: Ba's dinner missing (saved: Breakfast, Lunch, Dinner)
- placement: Thepla at Breakfast,Dinner (want Ba's dinner)
- personal_placement: Thepla (Ba's dinner's) saved at Breakfast,Dinner
- placement: Khichdi at Dinner (want Ba's dinner)
- personal_placement: Khichdi (Ba's dinner's) saved at Dinner
- seed_present: no seed for Ba's dinner

### h10-qureshi #1
- slot_people: Dinner for [] (want ["Farah"])
- skip_days: Dinner skips [] (want ["Sat ordered_in"])
- slot_kind: Zayan's dinner: addon of Dinner (want custom)
- placement: Upma at Zayan's breakfast (want Breakfast)
- rows_on_right_slot: Suji upma saved at Zayan's breakfast (want breakfast)
- no_wrong_personal: Suji upma saved as Zayan's breakfast's
- noted: halal not kept
- seed_present: no seed for Breakfast
- seed_present: no seed for Lunch
- seed_present: no seed for Dinner
- seed_on_slot: Zayan's breakfast seed ["Suji upma"]: mostly not Zayan's breakfast dishes

### h10-qureshi #2
- slot_people: Dinner for [] (want ["Farah"])
- slots_present: Zayan's dinner missing (saved: Breakfast, Lunch, Dinner)
- dish_frequency: Fish curry: saved {"frequency":null,"days":["Fri"]} (want {"frequency":null,"days":["Wed"]})
- placement: Khichdi at Lunch,Dinner (want Zayan's dinner)
- personal_placement: Khichdi (Zayan's dinner's) saved at Lunch,Dinner
- placement: Dal rice at Lunch,Dinner (want Zayan's dinner)
- personal_placement: Dal rice (Zayan's dinner's) saved at Lunch,Dinner
- placement: Vegetable daliya at Dinner (want Zayan's dinner)
- personal_placement: Vegetable daliya (Zayan's dinner's) saved at Dinner
- rows_on_right_slot: Khichdi saved at Dinner (want lunch,zayan's lunch,zayan's dinner)
- rows_on_right_slot: Dal rice saved at Dinner (want lunch,zayan's lunch,zayan's dinner)
- rows_on_right_slot: Vegetable daliya saved at Dinner (want zayan's dinner)
- no_unsaid_frequency: Paratha at Breakfast saved with {"frequency":"usually","days":null}
- no_unsaid_frequency: Bread omelette at Breakfast saved with {"frequency":"1/week","days":null}
- no_unsaid_frequency: Upma at Breakfast saved with {"frequency":"1/week","days":null}
- no_unsaid_rules: not said: [{"what":"cap","who":null,"items":null,"quote":"one dish is fine"}]
- seed_present: no seed for Zayan's dinner
- seed_on_slot: Dinner seed ["Khichdi"]: mostly not Dinner dishes
- seed_on_slot: Dinner seed ["Dal rice"]: mostly not Dinner dishes
- seed_on_slot: Dinner seed ["Vegetable daliya"]: mostly not Dinner dishes

### h11-dsouza #1
- lunch_unclear: asked about [] (want ["Vikram"])
- dish_frequency: Rajma: saved {"frequency":"1/week","days":null} (want {"frequency":"rarely","days":null})
- dish_frequency: Chole: saved {"frequency":"1/week","days":null} (want {"frequency":"rarely","days":null})
- seed_on_slot: Lunch seed ["Millets"]: mostly not Lunch dishes

### h11-dsouza #2
- lunch_unclear: asked about [] (want ["Vikram"])
- dish_frequency: Overnight oats: saved {"frequency":"2/week","days":null} (want {"frequency":"sometimes","days":null})
- dish_frequency: Rajma: saved {"frequency":"1/week","days":null} (want {"frequency":"rarely","days":null})
- dish_frequency: Chole: saved {"frequency":"1/week","days":null} (want {"frequency":"rarely","days":null})
- dish_frequency: Chicken curry: saved {"frequency":null,"days":["Sun"]} (want {"frequency":null,"days":["Sat","Sun"]})
- seed_on_slot: Lunch seed ["Millets"]: mostly not Lunch dishes

### h12-sen #1
- slots_present: Debjani and Mili's fish missing (saved: Breakfast, Lunch, Dinner, Mili's tiffin, Omprakash's dinner)
- placement: Macher jhol at Mili's tiffin (want Debjani and Mili's fish)
- personal_placement: Macher jhol (Debjani and Mili's fish's) saved at Mili's tiffin
- no_unsaid_frequency: Toast at Breakfast saved with {"frequency":"usually","days":null}
- no_unsaid_frequency: Poha at Breakfast saved with {"frequency":"2/week","days":null}
- no_unsaid_frequency: Besan chilla at Breakfast saved with {"frequency":"1/week","days":null}
- rows_on_right_slot: Macher jhol saved at Mili's tiffin (want debjani and mili's fish)
- no_wrong_personal: Macher jhol saved as Mili's tiffin's
- no_unsaid_rules: not said: [{"what":"no_eggs","who":"Sanjay","items":null,"quote":"no eggs"}]
- seed_present: no seed for Debjani and Mili's fish

### h12-sen #2
- slots_present: Debjani and Mili's fish missing (saved: Breakfast, Lunch, Dinner, Mili's tiffin, Omprakash's dinner)
- dish_frequency: Pasta: saved {"frequency":null,"days":null} (want {"frequency":null,"days":["Fri"]})
- dish_frequency: Kadhi: saved {"frequency":null,"days":null} (want {"frequency":"sometimes","days":null})
- placement: Macher jhol at Mili's tiffin (want Debjani and Mili's fish)
- personal_placement: Macher jhol (Debjani and Mili's fish's) saved at Mili's tiffin
- rows_on_right_slot: Macher jhol saved at Mili's tiffin (want debjani and mili's fish)
- no_wrong_personal: Macher jhol saved as Mili's tiffin's
- rows_on_right_slot: Roti saved at Mili's tiffin (want lunch,dinner)
- no_wrong_personal: Roti saved as Mili's tiffin's
- rows_on_right_slot: Dal saved at Mili's tiffin (want lunch,dinner)
- no_wrong_personal: Dal saved as Mili's tiffin's
- rows_on_right_slot: Sabzi saved at Mili's tiffin (want lunch,dinner)
- no_wrong_personal: Sabzi saved as Mili's tiffin's
- rows_on_right_slot: Dal saved at Omprakash's dinner (want lunch,dinner)
- no_wrong_personal: Dal saved as Omprakash's dinner's
- rows_on_right_slot: Sabzi saved at Omprakash's dinner (want lunch,dinner)
- no_wrong_personal: Sabzi saved as Omprakash's dinner's
- seed_present: no seed for Debjani and Mili's fish
- seed_on_slot: Mili's tiffin seed ["Roti","Dal","Sabzi","Macher jhol"]: mostly not Mili's tiffin dishes
- seed_on_slot: Omprakash's dinner seed ["Bajra roti","Dal","Sabzi"]: mostly not Omprakash's dinner dishes
- seed_on_slot: Omprakash's dinner seed ["Jowar roti","Dal","Sabzi"]: mostly not Omprakash's dinner dishes

## Top failure kinds

- dish_frequency: 11
- rows_on_right_slot: 11
- placement: 10
- personal_placement: 9
- seed_on_slot: 9
- seed_present: 8
- no_wrong_personal: 8
- no_unsaid_frequency: 6
- slot_people: 4
- slots_present: 4
- no_unsaid_rules: 2
- lunch_unclear: 2
- hard_rules: 1
- skip_days: 1
- slot_kind: 1
- noted: 1
