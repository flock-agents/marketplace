# Eval 2 (plan, truth) — 2026-11-23T10:54

week 2026-11-30; model deepseek/deepseek-v4-flash; judge anthropic/claude-sonnet-5.5; re-scored from the saved weeks (the run: 7.6 min, $0.163)

| household | meals_planned | order_in_kept | no_stray_meals | hard_rules | everyone_fed | personal_dish_freq | personal_dish_eaters | dish_frequency | meal_shape | own_slot_dishes | soft_frequency | family_dish_share | unmet | flagged | fits_dishes | meal_shape | variety | per_person | overall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| h1-sharma | 25/25 | 1/1 | 1/1 | 1/1 | 20/20 | 1/1 | 1/1 | 5/5 | 11/13 | 13/13 | – | 100 | 0 | 0 | 4 | 2 | 3 | 4 | 2 |
| h2-iyer | 20/20 | 1/1 | 1/1 | 3/3 | 20/20 | 2/2 | 3/3 | 6/6 | 15/20 | 13/13 | – | 100 | 2 | 1 | 4 | 2 | 3 | 3 | 2 |
| h3-shiva | 24/24 | 2/2 | 1/1 | 7/7 | 19/19 | 3/3 | 4/4 | 6/6 | 16/19 | 12/12 | 0/1 | 100 | 0 | 0 | 4 | 3 | 3 | 3 | 3 |
| h4-reddy | 26/26 | – | 1/1 | 4/4 | 21/21 | 4/5 | 14/14 | 2/2 | 11/21 | 9/14 | 0/1 | 100 | 3 | 1 | 4 | 3 | 2 | 4 | 3 |
| h5-agarwal | 26/26 | – | 1/1 | 4/4 | 21/21 | 1/1 | 2/2 | 3/3 | 11/14 | 14/14 | – | 100 | 3 | 1 | 4 | 2 | 3 | 2 | 2 |
| h6-kulkarni | 26/26 | – | 1/1 | 2/2 | 21/21 | 1/1 | 1/1 | 4/5 | 7/14 | 14/14 | – | 100 | 3 | 1 | 4 | 2 | 3 | 4 | 2 |
| h7-menon | 18/18 | 3/3 | 1/1 | 1/1 | 18/18 | 2/3 | 9/10 | 2/3 | 10/11 | 11/11 | – | 100 | 1 | 1 | 4 | 3 | 3 | 3 | 3 |
| h8-banerjee | 26/26 | – | 1/1 | 4/4 | 21/21 | 1/1 | 4/4 | 3/5 | 11/21 | 14/14 | – | 95 | 2 | 1 | 2 | 2 | 2 | 2 | 2 |
| **total** | 100% (191/191) | 100% (7/7) | 100% (8/8) | 100% (26/26) | 100% (161/161) | 88% (15/17) | 97% (38/39) | 89% (31/35) | 69% (92/133) | 95% (100/105) | 0% (0/2) | | | 6/8 | 3.8 | 2.4 | 2.8 | 3.1 | 2.4 |

## Misses

### h1-sharma
- meal_shape: Sat Lunch: 1 shared parts (want 5±1), no /chawal|rice|roti|chapati|phulka/i: Dal
- meal_shape: Sun Lunch: 1 shared parts (want 5±1), no /chawal|rice|roti|chapati|phulka/i: Dal
- judge: Sat and Sun lunch is only dal, with no chawal, roti, sabzi or raita. Fri lunch has two sabzis and no chawal; Fri dinner has no sabzi.

### h2-iyer
- meal_shape: Sat Breakfast: 2 shared parts (want 3±1), no /idli|dosa|upma|pongal|uthappam/i: Coconut chutney, Sambar
- meal_shape: Fri Lunch: 3 shared parts (want 5±1): Rice, Cabbage poriyal, Curd
- meal_shape: Sat Lunch: 3 shared parts (want 5±1): Rice, Poriyal, Curd, Curd rice
- meal_shape: Sun Lunch: 1 shared parts (want 5±1), no /rice/i: Cabbage poriyal
- meal_shape: Thu Dinner: 1 shared parts (want 2±1), no /dosa|chapati|uthappam|roti/i: Rasam rice
- judge: Sat breakfast has only chutney and sambar with no idli or dosa, and Sun lunch is just a cabbage poriyal with no rice, sambar, rasam or curd.
- planner said unmet: Sambar repeats on 3 days (Mon, Tue, Sat): only 7 breakfast dishes known; Cabbage poriyal repeats on 3 days (Tue, Fri, Sun): only 9 lunch dishes known

### h3-shiva
- soft_frequency: Gowri Shankar: "millets are good for him" in 5 meals (want 2–3)
- meal_shape: Mon Lunch: 2 shared parts (want 4±1), no /rice|bath/i: Rajma chawal, Curd
- meal_shape: Wed Lunch: 2 shared parts (want 4±1): Bisi bele bath, Curd
- meal_shape: Fri Lunch: 2 shared parts (want 4±1), no /rice|bath/i: Rajma chawal, Curd
- judge: Thursday lunch has no sambar, and Mon/Wed/Thu/Sun lunches and dinners lack a sabji or dal alongside; Thursday breakfast, lunch and dinner are thin.

### h4-reddy
- personal_dish_freq: Jowar roti [Sarojini] on 7 days (Mon,Tue,Wed,Thu,Fri,Sat,Sun), at most 3
- soft_frequency: Sarojini: "ragi is good for her, a few times a week" in 4 meals (want 2–3)
- meal_shape: Wed Lunch: 3 shared parts (want 6±1): Rice, Beans curry, Curd
- meal_shape: Thu Lunch: 3 shared parts (want 6±1): Rice, Dondakaya curry, Curd
- meal_shape: Fri Lunch: 3 shared parts (want 6±1): Rice, Bendakaya curry, Curd
- meal_shape: Sat Lunch: 3 shared parts (want 6±1): Rice, Dondakaya curry, Curd
- meal_shape: Sun Lunch: 4 shared parts (want 6±1): Rice, Chicken curry, Curd, Beans curry
- meal_shape: Wed Dinner: 4 shared parts (want 2±1): Chapati, Jowar roti, Pappu, Rice, Allam chutney
- meal_shape: Thu Dinner: 4 shared parts (want 2±1): Chapati, Jowar roti, Pappu, Rice, Allam chutney
- meal_shape: Fri Dinner: 4 shared parts (want 2±1): Chapati, Jowar roti, Pappu, Rice, Allam chutney
- meal_shape: Sat Dinner: 4 shared parts (want 2±1): Chapati, Jowar roti, Pappu, Rice, Allam chutney
- meal_shape: Sun Dinner: 4 shared parts (want 2±1): Chapati, Jowar roti, Pappu, Rice, Allam chutney
- own_slot_dishes: Wed Dinner: Allam chutney
- own_slot_dishes: Thu Dinner: Allam chutney
- own_slot_dishes: Fri Dinner: Allam chutney
- own_slot_dishes: Sat Dinner: Allam chutney
- own_slot_dishes: Sun Dinner: Allam chutney
- judge: Lunch loses pappu, rasam and pachadi from Wednesday on, so it falls short of the family's full lunch; dinner repeats chapati, jowar roti, pappu and rice nightly.
- planner said unmet: Pappu repeats on 7 days (Mon, Tue, Wed, Thu, Fri, Sat, Sun): only 4 dinner dishes known; Idli repeats on 3 days (Mon, Fri, Sat): only 8 breakfast dishes known; Beans curry repeats on 3 days (Mon, Wed, Sun): only 9 lunch dishes known

### h5-agarwal
- meal_shape: Fri Lunch: 1 shared parts (want 4±1), no /chawal|rice|roti|baati/i: Dal
- meal_shape: Sat Lunch: 1 shared parts (want 4±1), no /chawal|rice|roti|baati/i: Dal
- meal_shape: Sun Lunch: 2 shared parts (want 4±1): Dal baati, Dal
- judge: Sat lunch is Dal only and Fri too; Kamla's Sat Poha/Dal and Tue lunch lack no-onion-garlic, Ramesh's Tue lunch unmarked.
- planner said unmet: Besan chilla repeats on 4 days (Tue, Wed, Thu, Fri): only 4 breakfast dishes known; Aloo sandwich repeats on 3 days (Mon, Thu, Fri): only 3 reyansh's tiffin dishes known; Poha repeats on 4 days (Mon, Wed, Sat, Sun): only 4 breakfast dishes known

### h6-kulkarni
- dish_frequency: Amti (sometimes) planned on Wed,Thu,Fri
- meal_shape: Wed Lunch: 1 shared parts (want 4±1), no /poli|chapati|bhaat|rice|bhakri/i: Amti
- meal_shape: Thu Lunch: 1 shared parts (want 4±1), no /poli|chapati|bhaat|rice|bhakri/i: Amti
- meal_shape: Fri Lunch: 1 shared parts (want 4±1), no /poli|chapati|bhaat|rice|bhakri/i: Amti
- meal_shape: Sat Lunch: 1 shared parts (want 4±1), no /poli|chapati|bhaat|rice|bhakri/i: Bhaji
- meal_shape: Sun Lunch: 1 shared parts (want 4±1), no /poli|chapati|bhaat|rice|bhakri/i: Chicken rassa
- meal_shape: Fri Dinner: 1 shared parts (want 2±1), no /bhakri|poli|chapati|roti/i: Usal
- meal_shape: Sat Dinner: 1 shared parts (want 2±1), no /bhakri|poli|chapati|roti/i: Fish fry
- judge: Lunches on Wed-Fri and Sat/Sun are single dishes (Amti or Bhaji alone), missing poli, bhaji, varan bhaat and koshimbir; Thu and Sun dinners lack usal or pithla.
- planner said unmet: Bhakri repeats on 4 days (Tue, Wed, Thu, Sun): only 5 dinner dishes known; Amti is on 3 days (Wed, Thu, Fri): the family has it sometimes: 2 days a week at most; Bhaji repeats on 3 days (Mon, Tue, Sat): only 6 lunch dishes known

### h7-menon
- personal_dish_freq: Eggs [Nikhil] on 6 days (Mon,Tue,Wed,Thu,Fri,Sun), at most 5
- personal_dish_eaters: Sun Breakfast: Eggs (Nikhil's) given to Tanya
- dish_frequency: Eggs (usually) planned on Mon,Tue,Wed,Thu,Fri,Sun
- meal_shape: Wed Lunch: 2 shared parts (want 4±1): Chicken curry, Dal, Rice, Salad
- judge: Thursday dinner biryani is a rare dish, and its unspecified meat may be red, which breaks Tanya's rule. Fri dinner has no chicken or paneer, and Wed dinner is chicken with dal and no sabzi.
- planner said unmet: Eggs is on 6 days (Mon, Tue, Wed, Thu, Fri, Sun): the family has it usually: 5 days a week at most

### h8-banerjee
- dish_frequency: Luchi (Sun) planned on Thu,Sat
- dish_frequency: Alur dom (Sun) planned on Wed,Fri,Sun
- meal_shape: Mon Breakfast: 4 shared parts (want 2±1): Toast, Egg, Muri, Chire bhaja
- meal_shape: Tue Breakfast: 4 shared parts (want 2±1): Toast, Egg, Muri, Chire bhaja
- meal_shape: Wed Breakfast: 1 shared parts (want 2±1), no /toast|muri|chire|luchi|bread/i: Alur dom
- meal_shape: Fri Breakfast: 1 shared parts (want 2±1), no /toast|muri|chire|luchi|bread/i: Alur dom
- meal_shape: Sun Breakfast: 1 shared parts (want 2±1), no /toast|muri|chire|luchi|bread/i: Alur dom
- meal_shape: Wed Lunch: 1 shared parts (want 5±1), no /bhaat|rice/i: Maacher jhol
- meal_shape: Thu Lunch: 1 shared parts (want 5±1), no /bhaat|rice/i: Maacher jhol
- meal_shape: Fri Lunch: 1 shared parts (want 5±1), no /bhaat|rice/i: Maacher jhol
- meal_shape: Sat Lunch: 1 shared parts (want 5±1), no /bhaat|rice/i: Dal
- meal_shape: Sun Lunch: 1 shared parts (want 5±1), no /bhaat|rice/i: Kosha mangsho
- judge: Luchi and alur dom are scattered across weekdays and Saturday instead of Sunday only. Wed-Sun lunches drop bhaat, dal, bhaja and torkari, and Sunday has no luchi.
- planner said unmet: Alur dom is on 3 days (Wed, Fri, Sun): the family has it on Sun only; Luchi is on 2 days (Thu, Sat): the family has it on Sun only

## Top failure kinds

- meal_shape: 41
- own_slot_dishes: 5
- dish_frequency: 4
- soft_frequency: 2
- personal_dish_freq: 2
- personal_dish_eaters: 1
