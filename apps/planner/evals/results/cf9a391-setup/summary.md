# Eval 1 (setup) — 2026-11-23T10:45

model deepseek/deepseek-v4-flash; persona deepseek/deepseek-v4-flash; repeat 1; 2.7 min; spend $0.036 (230 calls); re-scored after a scorer fix

| household | people | cook_days | cook_times | home_cook | slots_present | slot_days | slot_for | no_extra_slots | order_in | hard_rules | no_unsaid_rules | soft_notes | soft_kept_soft | dish_no_wrong_restriction | personal_dishes | dish_coverage | dish_slots | dish_frequency | meal_examples | rule_frequency |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| h1-sharma | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 0/1 | 19/19 | 19/19 | 2/5 | 2/2 | – |
| h2-iyer | 1/1 | 1/1 | – | 1/1 | – | – | – | 1/1 | 1/1 | 3/3 | 1/1 | 0/1 | 1/1 | 1/1 | 0/2 | 13/19 | 13/13 | 3/6 | 3/3 | – |
| h3-shiva | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 7/7 | 1/1 | 3/4 | 4/4 | 1/1 | 3/3 | 25/29 | 24/25 | 4/6 | 3/3 | 0/1 |
| h4-reddy | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 4/5 | 1/1 | 3/3 | 3/3 | 0/1 | 2/5 | 23/23 | 22/23 | 2/2 | 3/3 | 1/1 |
| h5-agarwal | 1/1 | 1/1 | – | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 4/4 | 1/1 | – | – | 1/1 | 0/1 | 15/15 | 15/15 | 3/3 | 2/2 | – |
| h6-kulkarni | 1/1 | 1/1 | 1/1 | 2/2 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 2/2 | 1/1 | – | – | 1/1 | 1/1 | 19/19 | 18/19 | 3/5 | 2/2 | – |
| h7-menon | 1/1 | 1/1 | 0/1 | 1/2 | – | – | – | 1/1 | 1/1 | 1/1 | 1/1 | 0/1 | 1/1 | 0/1 | 3/3 | 12/13 | 12/12 | 1/3 | 2/2 | – |
| h8-banerjee | 1/1 | 1/1 | 1/1 | – | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 4/4 | 1/1 | 1/1 | 1/1 | 1/1 | 0/1 | 16/18 | 16/16 | 4/5 | 3/3 | – |
| **total** | 100% (8/8) | 100% (8/8) | 83% (5/6) | 89% (8/9) | 100% (6/6) | 100% (6/6) | 100% (6/6) | 100% (8/8) | 100% (8/8) | 96% (26/27) | 100% (8/8) | 73% (8/11) | 100% (11/11) | 75% (6/8) | 53% (9/17) | 92% (142/155) | 98% (139/142) | 63% (22/35) | 100% (20/20) | 50% (1/2) |

## Misses

### h1-sharma
- personal_dishes: Cornflakes for Vihaan: saved for "everyone"
- dish_frequency: Aloo paratha (Sat,Sun): saved {}
- dish_frequency: Cornflakes (sometimes): saved {}
- dish_frequency: Chicken curry (Sat,Sun): saved {"days":["Sat"]}

### h2-iyer
- soft_notes: missing: Ananya: less spicy for Ananya
- personal_dishes: Ragi porridge for Ananya: saved for "everyone"
- personal_dishes: Curd rice for Ananya: not saved
- dish_frequency: Kootu (sometimes): not saved
- dish_frequency: Curd rice (rarely): not saved
- dish_frequency: Rasam rice (sometimes): not saved

### h3-shiva
- soft_notes: missing: Gowri Shankar: millets are good for him
- rule_frequency: Gowri Shankar: "millets are good for him" saved without often=sometimes
- dish_slots: Sandwich at Agastya's tiffin (want Breakfast)
- dish_frequency: Aloo paratha (Sat,Sun): saved {}
- dish_frequency: Lemon rice (Fri): saved {}

### h4-reddy
- hard_rules: missing: Chicken only at Sunday lunch
- dish_no_wrong_restriction: restricted though everyone's: Idli [Arjun+Srinivas+Padma], Pesarattu [Arjun], Upma [Arjun], Dosa [Srinivas], Allam chutney [Srinivas]
- personal_dishes: Ragi dosa for Sarojini: saved for "everyone"
- personal_dishes: Ragi java for Sarojini: saved for "everyone"
- personal_dishes: Jowar roti for Sarojini: saved for "everyone"
- dish_slots: Rasam at Dinner (want Lunch)

### h5-agarwal
- personal_dishes: Dalia for Ramesh: saved for "everyone"

### h6-kulkarni
- dish_frequency: Thalipeeth (Sat,Sun): saved {}
- dish_frequency: Noodles (sometimes, Fri): saved {"days":["Fri"]}
- dish_slots: Chicken rassa at Dinner (want Lunch)

### h7-menon
- cook_times: [{"at":"11:00","meals":["Lunch"]}] (want [{"at":"11:00","meals":["Lunch","Dinner"]}])
- home_cook: Nikhil on Sat,Sun: ["Sun Tanya cooks"]
- soft_notes: missing: Nikhil: high protein
- dish_no_wrong_restriction: restricted though everyone's: Toast with peanut butter [Tanya]
- dish_frequency: Toast (sometimes): saved {}
- dish_frequency: Biryani (rarely): not saved

### h8-banerjee
- personal_dishes: Veg torkari for Gita: not saved
- dish_frequency: Kosha mangsho (Sun): not saved

## Top failure kinds

- dish_frequency: 13
- personal_dishes: 8
- soft_notes: 3
- dish_slots: 3
- dish_no_wrong_restriction: 2
- rule_frequency: 1
- hard_rules: 1
- cook_times: 1
- home_cook: 1
