# Eval 2 (plan, from-eval1) — 2026-11-23T10:54

week 2026-11-30; model deepseek/deepseek-v4-flash; judge anthropic/claude-sonnet-5.5; re-scored from the saved weeks (the run: 9.2 min, $0.095)

| household | meals_planned | order_in_kept | no_stray_meals | hard_rules | everyone_fed | personal_dish_freq | personal_dish_eaters | dish_frequency | meal_shape | own_slot_dishes | soft_frequency | family_dish_share | unmet | flagged | fits_dishes | meal_shape | variety | per_person | overall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| h1-sharma | 25/25 | 1/1 | 1/1 | 1/1 | 20/20 | 1/1 | 0/1 | 5/5 | 12/13 | 13/13 | – | 96 | 0 | 0 | – | – | – | – | – |
| h2-iyer | 20/20 | 1/1 | 1/1 | 3/3 | 20/20 | 2/2 | 0/1 | 6/6 | 18/20 | 13/13 | – | 84 | 0 | 0 | – | – | – | – | – |
| h3-shiva | 24/24 | 2/2 | 1/1 | 7/7 | 19/19 | 3/3 | 2/2 | 6/6 | 15/19 | 12/12 | 0/1 | 82 | 1 | 1 | – | – | – | – | – |
| h4-reddy | 26/26 | – | 1/1 | 4/4 | 21/21 | 4/5 | 9/11 | 2/2 | 15/21 | 14/14 | 0/1 | 91 | 2 | 1 | – | – | – | – | – |
| h5-agarwal | 26/26 | – | 1/1 | 4/4 | 21/21 | 1/1 | 0/2 | 3/3 | 12/14 | 14/14 | – | 100 | 2 | 1 | – | – | – | – | – |
| h6-kulkarni | 26/26 | – | 1/1 | 2/2 | 21/21 | 1/1 | – | 3/5 | 5/14 | 14/14 | – | 100 | 3 | 1 | – | – | – | – | – |
| h7-menon | 18/18 | 3/3 | 1/1 | 1/1 | 18/18 | 3/3 | 9/10 | 2/3 | 10/11 | 11/11 | – | 98 | 2 | 1 | – | – | – | – | – |
| h8-banerjee | 26/26 | – | 1/1 | 4/4 | 21/21 | 1/1 | – | 3/5 | 18/21 | 14/14 | – | 97 | 1 | 1 | – | – | – | – | – |
| **total** | 100% (191/191) | 100% (7/7) | 100% (8/8) | 100% (26/26) | 100% (161/161) | 94% (16/17) | 74% (20/27) | 86% (30/35) | 79% (105/133) | 100% (105/105) | 0% (0/2) | | | 6/8 | – | – | – | – | – |

## Misses

### h1-sharma
- personal_dish_eaters: Thu Breakfast: Cornflakes (Vihaan's) given to Rohit, Neha
- meal_shape: Sun Lunch: 3 shared parts (want 5±1): Dal, Roti, Raita

### h2-iyer
- personal_dish_eaters: Fri Breakfast: Ragi porridge (Ananya's) given to Karthik, Meenakshi
- meal_shape: Fri Breakfast: 1 shared parts (want 3±1), no /idli|dosa|upma|pongal|uthappam/i: Ragi porridge
- meal_shape: Wed Lunch: 3 shared parts (want 5±1): Rice, Rasam, Curd

### h3-shiva
- soft_frequency: Gowri Shankar: "millets are good for him" in 1 meals (want 2–3)
- meal_shape: Tue Lunch: 1 shared parts (want 4±1), no /rice|bath/i: Rajma chawal
- meal_shape: Thu Lunch: 1 shared parts (want 4±1), no /rice|bath/i: Rajma chawal
- meal_shape: Fri Lunch: 2 shared parts (want 4±1): Rice, Sabji
- meal_shape: Sat Lunch: 1 shared parts (want 4±1): Bisi bele bath
- planner said unmet: Sabji repeats on 3 days (Mon, Wed, Fri): only 5 lunch dishes known

### h4-reddy
- personal_dish_freq: Jowar roti [Sarojini] on 6 days (Tue,Wed,Thu,Fri,Sat,Sun), at most 3
- personal_dish_eaters: Mon Breakfast: Ragi dosa (Sarojini's) given to Venkat
- personal_dish_eaters: Sun Breakfast: Bread toast (Arjun's) given to Srinivas, Padma, Sarojini, Venkat
- soft_frequency: Sarojini: "ragi is good for her, a few times a week" in 4 meals (want 2–3)
- meal_shape: Sun Breakfast: 1 shared parts (want 2±1), no /idli|pesarattu|upma|dosa/i: Bread toast
- meal_shape: Wed Lunch: 4 shared parts (want 6±1): Rice, Beans curry, Curd, Curry
- meal_shape: Thu Lunch: 3 shared parts (want 6±1): Rice, Dondakaya curry, Curd
- meal_shape: Fri Lunch: 3 shared parts (want 6±1): Rice, Bendakaya curry, Curd
- meal_shape: Sat Lunch: 3 shared parts (want 6±1): Rice, Dondakaya curry, Curd
- meal_shape: Sun Lunch: 4 shared parts (want 6±1): Chicken, Curry, Curd, Rice
- planner said unmet: Bendakaya curry is on 3 days (Mon, Tue, Fri): the family has it twice a week; Bread toast is on 2 days (Fri, Sun): the family has it once a week

### h5-agarwal
- personal_dish_eaters: Tue Breakfast: Dalia (Ramesh's) given to Ankit, Pooja, Reyansh, Kamla
- personal_dish_eaters: Sat Breakfast: Dalia (Ramesh's) given to Ankit, Pooja, Reyansh, Kamla
- meal_shape: Fri Lunch: 2 shared parts (want 4±1): Dal, Roti
- meal_shape: Sat Lunch: 2 shared parts (want 4±1): Dal, Roti
- planner said unmet: Aloo sandwich repeats on 3 days (Mon, Thu, Fri): only 3 reyansh's tiffin dishes known; Besan chilla repeats on 3 days (Mon, Fri, Sun): only 4 breakfast dishes known

### h6-kulkarni
- dish_frequency: Thalipeeth (Sat,Sun) planned on Thu
- dish_frequency: Amti (sometimes) planned on Tue,Wed,Thu,Sat
- meal_shape: Wed Lunch: 1 shared parts (want 4±1), no /poli|chapati|bhaat|rice|bhakri/i: Amti
- meal_shape: Thu Lunch: 1 shared parts (want 4±1), no /poli|chapati|bhaat|rice|bhakri/i: Amti
- meal_shape: Fri Lunch: 1 shared parts (want 4±1), no /poli|chapati|bhaat|rice|bhakri/i: Bhaji
- meal_shape: Sat Lunch: 1 shared parts (want 4±1), no /poli|chapati|bhaat|rice|bhakri/i: Amti
- meal_shape: Sun Lunch: 1 shared parts (want 4±1): Varan bhaat
- meal_shape: Thu Dinner: 1 shared parts (want 2±1), no /bhakri|poli|chapati|roti/i: Usal
- meal_shape: Fri Dinner: 1 shared parts (want 2±1), no /bhakri|poli|chapati|roti/i: Usal
- meal_shape: Sat Dinner: 1 shared parts (want 2±1), no /bhakri|poli|chapati|roti/i: Fish fry
- meal_shape: Sun Dinner: 1 shared parts (want 2±1), no /bhakri|poli|chapati|roti/i: Chicken rassa
- planner said unmet: Amti is on 4 days (Tue, Wed, Thu, Sat): the family has it sometimes: 2 days a week at most; Bhaji repeats on 3 days (Mon, Tue, Fri): only 5 lunch dishes known; Usal repeats on 3 days (Mon, Thu, Fri): only 6 dinner dishes known

### h7-menon
- personal_dish_eaters: Sun Breakfast: Oats (Tanya's) given to Nikhil
- dish_frequency: Toast (sometimes) planned on Wed,Sat,Sun
- meal_shape: Wed Lunch: 2 shared parts (want 4±1): Chicken curry, Dal, Rice, Salad
- planner said unmet: Oats repeats on 3 days (Mon, Thu, Sun): only 4 breakfast dishes known; Toast with peanut butter repeats on 3 days (Wed, Sat, Sun): only 4 breakfast dishes known

### h8-banerjee
- dish_frequency: Alur dom (Sun) planned on Fri
- dish_frequency: Fish (sometimes) planned on Mon,Thu,Fri,Sat
- meal_shape: Fri Breakfast: 1 shared parts (want 2±1), no /toast|muri|chire|luchi|bread/i: Alur dom
- meal_shape: Sat Lunch: 2 shared parts (want 5±1), no /bhaat|rice/i: Dal, Maacher jhol
- meal_shape: Sun Lunch: 2 shared parts (want 5±1), no /bhaat|rice/i: Dal, Maacher jhol
- planner said unmet: Alur dom is on 1 days (Fri): the family has it on Sun only

## Top failure kinds

- meal_shape: 28
- personal_dish_eaters: 7
- dish_frequency: 5
- soft_frequency: 2
- personal_dish_freq: 1
