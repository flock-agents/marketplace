# Eval 1 (setup) — 2026-11-23T10:45

model deepseek/deepseek-v4-flash; persona deepseek/deepseek-v4-flash; repeat 1; 3.4 min; spend $0.033 (228 calls); planner at 257ef20, re-scored with the current fixtures and scorer

| household | people | cook_days | cook_times | home_cook | slots_present | slot_days | slot_for | no_extra_slots | order_in | hard_rules | no_unsaid_rules | soft_notes | soft_kept_soft | dish_no_wrong_restriction | personal_dishes | dish_coverage | dish_slots | dish_frequency | meal_examples | rule_frequency |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| h1-sharma | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 0/1 | 1/1 | 1/1 | 0/1 | 1/1 | 1/1 | 19/19 | 19/19 | 0/5 | 2/2 | – |
| h2-iyer | 1/1 | 1/1 | – | 1/1 | – | – | – | 1/1 | 1/1 | 3/3 | 1/1 | 1/1 | 1/1 | 1/1 | 0/2 | 14/19 | 14/14 | 0/6 | 3/3 | – |
| h3-shiva | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 7/7 | 0/1 | 3/4 | 4/4 | 0/1 | 3/3 | 26/29 | 26/26 | 0/6 | 3/3 | 0/1 |
| h4-reddy | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 2/5 | 1/1 | 2/3 | 3/3 | 1/1 | 0/5 | 0/23 | – | 0/2 | 2/3 | 0/1 |
| h5-agarwal | 1/1 | 1/1 | – | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 4/4 | 1/1 | – | – | 1/1 | 0/1 | 14/15 | 13/14 | 0/3 | 2/2 | – |
| h6-kulkarni | 1/1 | 1/1 | 1/1 | 2/2 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 2/2 | 1/1 | – | – | 1/1 | 1/1 | 19/19 | 19/19 | 0/5 | 2/2 | – |
| h7-menon | 1/1 | 1/1 | 0/1 | 1/2 | – | – | – | 1/1 | 1/1 | 0/1 | 1/1 | 0/1 | 1/1 | 0/1 | 3/3 | 12/13 | 12/12 | 0/3 | 2/2 | – |
| h8-banerjee | 1/1 | 1/1 | 1/1 | – | 1/1 | 1/1 | 1/1 | 1/1 | 0/1 | 3/4 | 1/1 | 1/1 | 0/1 | 1/1 | 1/1 | 17/18 | 16/17 | 0/5 | 3/3 | – |
| **total** | 100% (8/8) | 100% (8/8) | 83% (5/6) | 89% (8/9) | 100% (6/6) | 100% (6/6) | 100% (6/6) | 100% (8/8) | 88% (7/8) | 78% (21/27) | 88% (7/8) | 73% (8/11) | 82% (9/11) | 75% (6/8) | 53% (9/17) | 78% (121/155) | 98% (119/121) | 0% (0/35) | 95% (19/20) | 0% (0/2) |

## Misses

### h1-sharma
- hard_rules: missing: Chicken (non-veg) only on Saturday and Sunday
- soft_kept_soft: Vihaan: "less spicy for Vihaan" saved as avoid ["@chilli"]
- dish_frequency: Aloo paratha (Sat,Sun): saved {}
- dish_frequency: Cornflakes (sometimes): saved {}
- dish_frequency: Maggi (Fri): saved {}
- dish_frequency: Rajma chawal (2/wk): saved {}
- dish_frequency: Chicken curry (Sat,Sun): saved {}

### h2-iyer
- personal_dishes: Ragi porridge for Ananya: saved for "everyone"
- personal_dishes: Curd rice for Ananya: not saved
- dish_frequency: Ragi porridge (sometimes): saved {}
- dish_frequency: Pongal (Sun): saved {}
- dish_frequency: Kootu (sometimes): not saved
- dish_frequency: Curd rice (rarely): not saved
- dish_frequency: Uthappam (sometimes): saved {}
- dish_frequency: Rasam rice (sometimes): not saved

### h3-shiva
- no_unsaid_rules: not said: [{"kind":"other","days":[],"note":"less spicy for the child"}]
- soft_notes: missing: Agastya: less spicy for Agastya
- rule_frequency: Gowri Shankar: "millets are good for him" saved without often=sometimes
- dish_no_wrong_restriction: restricted though everyone's: Phulkas [Gowri Shankar]
- dish_frequency: Aloo paratha (Sat,Sun): saved {}
- dish_frequency: Lemon rice (Fri): saved {}
- dish_frequency: Rajma chawal (2/wk): not saved
- dish_frequency: Chapati (usually): saved {}
- dish_frequency: Chole (1/wk): saved {}
- dish_frequency: Curd rice (sometimes): saved {}

### h4-reddy
- hard_rules: missing: Sarojini: pure veg, no eggs
- hard_rules: missing: Venkat: pure veg, no eggs
- hard_rules: missing: Chicken only at Sunday lunch
- soft_notes: missing: Sarojini: ragi is good for her, a few times a week
- rule_frequency: Sarojini: "ragi is good for her, a few times a week" saved without often=sometimes
- personal_dishes: Bread toast for Arjun: not saved
- personal_dishes: Ragi dosa for Sarojini: not saved
- personal_dishes: Ragi java for Sarojini: not saved
- personal_dishes: Chicken curry for Srinivas+Padma+Arjun: not saved
- personal_dishes: Jowar roti for Sarojini: not saved
- dish_frequency: Bread toast (sometimes): not saved
- dish_frequency: Chicken curry (Sun): not saved
- meal_examples: no Lunch example

### h5-agarwal
- personal_dishes: Dalia for Ramesh: saved for "everyone"
- dish_frequency: Kadhi chawal (sometimes): saved {}
- dish_slots: Dal baati at Dinner (want Lunch)
- dish_frequency: Dal baati (Sun): saved {}
- dish_frequency: Khichdi (Sat): saved {}

### h6-kulkarni
- dish_frequency: Thalipeeth (Sat,Sun): saved {}
- dish_frequency: Noodles (sometimes, Fri): saved {}
- dish_frequency: Amti (sometimes): saved {}
- dish_frequency: Fish fry (Sat): saved {}
- dish_frequency: Chicken rassa (Sun): saved {}

### h7-menon
- cook_times: [{"at":"11:00","meals":["Lunch"]}] (want [{"at":"11:00","meals":["Lunch","Dinner"]}])
- home_cook: Nikhil on Sat,Sun: ["Sun Tanya cooks"]
- hard_rules: missing: Tanya: no red meat
- soft_notes: missing: Nikhil: high protein
- dish_no_wrong_restriction: restricted though everyone's: Toast [Tanya]
- dish_frequency: Eggs (usually): saved {}
- dish_frequency: Toast (sometimes): saved {}
- dish_frequency: Biryani (rarely): not saved

### h8-banerjee
- order_in: ["Sat Dinner"] (want [])
- hard_rules: missing: Gita: vegetarian, no fish, meat or eggs
- soft_kept_soft: Pradip: "less oil" saved as avoid ["oil"]
- dish_frequency: Luchi (Sun): saved {}
- dish_frequency: Alur dom (Sun): saved {}
- dish_frequency: Maacher jhol (usually): saved {}
- dish_frequency: Kosha mangsho (Sun): saved {}
- dish_slots: Fish at Lunch (want Dinner)
- dish_frequency: Fish (sometimes): saved {}

## Top failure kinds

- dish_frequency: 35
- personal_dishes: 8
- hard_rules: 6
- soft_notes: 3
- soft_kept_soft: 2
- rule_frequency: 2
- dish_no_wrong_restriction: 2
- dish_slots: 2
- no_unsaid_rules: 1
- meal_examples: 1
- cook_times: 1
- home_cook: 1
- order_in: 1
