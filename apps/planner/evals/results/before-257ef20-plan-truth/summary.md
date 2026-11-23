# Eval 2 (plan, truth) — 2026-11-23T10:36

week 2026-11-30; model deepseek/deepseek-v4-flash; judge anthropic/claude-sonnet-5.5; re-scored from the saved weeks (the run: 8.5 min, $0.172)

| household | meals_planned | order_in_kept | no_stray_meals | hard_rules | everyone_fed | personal_dish_freq | personal_dish_eaters | dish_frequency | meal_shape | own_slot_dishes | soft_frequency | family_dish_share | unmet | flagged | fits_dishes | meal_shape | variety | per_person | overall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| h1-sharma | 25/25 | 1/1 | 1/1 | 1/1 | 20/20 | 0/1 | 7/7 | 2/5 | 12/13 | 13/13 | – | 100 | 0 | 0 | 3 | 2 | 2 | 4 | 2 |
| h2-iyer | 20/20 | 1/1 | 1/1 | 3/3 | 20/20 | 1/2 | 0/4 | 4/6 | 18/20 | 13/13 | – | 100 | 1 | 1 | 4 | 2 | 2 | 2 | 2 |
| h3-shiva | 24/24 | 2/2 | 1/1 | 7/7 | 19/19 | 1/3 | 8/10 | 0/2 | 19/19 | 12/12 | 0/1 | 100 | 0 | 0 | 3 | 3 | 2 | 3 | 3 |
| h4-reddy | 26/26 | – | 1/1 | 4/4 | 21/21 | 3/5 | 15/15 | 2/2 | 16/21 | 14/14 | 0/1 | 94 | 1 | 1 | 3 | 2 | 2 | 3 | 2 |
| h5-agarwal | 26/26 | – | 1/1 | 4/4 | 21/21 | 0/1 | 7/7 | 1/3 | 12/14 | 14/14 | – | 100 | 2 | 1 | 3 | 2 | 2 | 2 | 2 |
| h6-kulkarni | 26/26 | – | 1/1 | 2/2 | 21/21 | 0/1 | 2/3 | 1/5 | 5/14 | 14/14 | – | 100 | 3 | 1 | 3 | 2 | 2 | 3 | 2 |
| h7-menon | 18/18 | 3/3 | 1/1 | 1/1 | 18/18 | 0/3 | 13/18 | 2/3 | 11/11 | 11/11 | – | 100 | 0 | 0 | 3 | 3 | 2 | 2 | 2 |
| h8-banerjee | 26/26 | – | 1/1 | 4/4 | 21/21 | 0/1 | 14/14 | 1/5 | 13/21 | 14/14 | – | 100 | 3 | 1 | 2 | 2 | 1 | 2 | 1 |
| **total** | 100% (191/191) | 100% (7/7) | 100% (8/8) | 100% (26/26) | 100% (161/161) | 29% (5/17) | 85% (66/78) | 42% (13/31) | 80% (106/133) | 100% (105/105) | 0% (0/2) | | | 5/8 | 3.0 | 2.3 | 1.9 | 2.6 | 2.0 |

## Misses

### h1-sharma
- personal_dish_freq: Cornflakes [Vihaan] on 7 days (Mon,Tue,Wed,Thu,Fri,Sat,Sun), at most 2
- dish_frequency: Aloo paratha (Sat,Sun) planned on Mon,Fri
- dish_frequency: Cornflakes (sometimes) planned on Mon,Tue,Wed,Thu,Fri,Sat,Sun
- dish_frequency: Maggi (Fri) planned on Wed
- meal_shape: Sat Lunch: 1 shared parts (want 5±1), no /chawal|rice|roti|chapati|phulka/i: Dal
- judge: Saturday lunch is only dal, with no chawal, roti, sabzi or raita; several other lunches also lack chawal.

### h2-iyer
- personal_dish_freq: Curd rice [Ananya] on 2 days (Sat,Sun), at most 1
- personal_dish_eaters: Wed Breakfast: Ragi porridge (Ananya's) given to Karthik, Meenakshi
- personal_dish_eaters: Thu Breakfast: Ragi porridge (Ananya's) given to Karthik, Meenakshi
- personal_dish_eaters: Sat Lunch: Curd rice (Ananya's) given to Karthik, Meenakshi
- personal_dish_eaters: Sun Lunch: Curd rice (Ananya's) given to Karthik, Meenakshi
- dish_frequency: Pongal (Sun) planned on Sat,Sun
- dish_frequency: Curd rice (rarely) planned on Sat,Sun
- meal_shape: Fri Lunch: 1 shared parts (want 5±1), no /rice/i: Poriyal
- meal_shape: Sun Lunch: 3 shared parts (want 5±1): Rice, Curd rice, Curd
- judge: Pongal appears on Saturday although it is a Sunday-only dish, and Friday lunch is just a poriyal with no rice, sambar or curd.
- planner said unmet: Kurma repeats on 3 days (Mon, Tue, Fri): only 6 dinner dishes known

### h3-shiva
- personal_dish_freq: Ragi dosa [Gowri Shankar] on 5 days (Mon,Wed,Fri,Sat,Sun), at most 3
- personal_dish_freq: Curd rice [Agastya] on 2 days (Mon,Wed), at most 1
- personal_dish_eaters: Sat Breakfast: Ragi dosa (Gowri Shankar's) given to Shiva, Ankita
- personal_dish_eaters: Sun Breakfast: Ragi dosa (Gowri Shankar's) given to Shiva, Ankita, Agastya
- dish_frequency: Aloo paratha (Sat,Sun) planned on Thu,Sat
- dish_frequency: Curd rice (rarely) planned on Mon,Wed
- soft_frequency: Gowri Shankar: "millets are good for him" in 7 meals (want 2–6)
- judge: Ragi dosa, Gowri Shankar's own dish, is served 5 times and to others on Sat and Sun. Aloo paratha is on Thursday, though it is only for Sat and Sun.

### h4-reddy
- personal_dish_freq: Ragi dosa [Sarojini] on 6 days (Mon,Tue,Thu,Fri,Sat,Sun), at most 3
- personal_dish_freq: Jowar roti [Sarojini] on 7 days (Mon,Tue,Wed,Thu,Fri,Sat,Sun), at most 3
- meal_shape: Wed Lunch: 4 shared parts (want 6±1): Rice, Beans curry, Bendakaya curry, Curd
- meal_shape: Thu Lunch: 4 shared parts (want 6±1): Rice, Bendakaya curry, Dondakaya curry, Curd
- meal_shape: Fri Lunch: 3 shared parts (want 6±1): Rice, Bendakaya curry, Curd
- meal_shape: Sat Lunch: 3 shared parts (want 6±1): Rice, Bendakaya curry, Curd
- meal_shape: Sun Lunch: 4 shared parts (want 6±1): Rice, Bendakaya curry, Chicken curry, Curd
- soft_frequency: Sarojini: "ragi is good for her, a few times a week" in 7 meals (want 2–5)
- judge: Lunches lose pappu, rasam and pachadi from Wednesday on, and dinners use dishes outside their list (baingan bharta, masoor, moong and chana dal) while Bendakaya curry repeats almost daily.
- planner said unmet: Bendakaya curry repeats on 5 days (Wed, Thu, Fri, Sat, Sun): only 9 lunch dishes known

### h5-agarwal
- personal_dish_freq: Dalia [Ramesh] on 7 days (Mon,Tue,Wed,Thu,Fri,Sat,Sun), at most 3
- dish_frequency: Dal baati (Sun) planned on Tue,Fri
- dish_frequency: Khichdi (Sat) planned on Wed,Sat,Sun
- meal_shape: Sat Lunch: 2 shared parts (want 4±1): Roti, Dal
- meal_shape: Sun Lunch: 2 shared parts (want 4±1): Dal, Roti
- judge: Dal baati is on Tue and Fri instead of Sunday only. Khichdi is on Wed and Sun instead of Saturday night. Sunday has no baati.
- planner said unmet: Besan chilla repeats on 3 days (Mon, Thu, Sun): only 4 breakfast dishes known; Khichdi repeats on 3 days (Wed, Sat, Sun): only 6 dinner dishes known

### h6-kulkarni
- personal_dish_freq: Noodles [Ishaan] on 3 days (Mon,Wed,Thu), at most 2
- personal_dish_eaters: Thu Snack box: Noodles (Ishaan's) given to Aditi
- dish_frequency: Thalipeeth (Sat,Sun) planned on Wed,Sun
- dish_frequency: Noodles (sometimes, Fri) planned on Mon,Wed,Thu
- dish_frequency: Fish fry (Sat) planned on Sat,Sun
- dish_frequency: Chicken rassa (Sun) planned on Sat
- meal_shape: Wed Lunch: 1 shared parts (want 4±1), no /poli|chapati|bhaat|rice|bhakri/i: Bhaji
- meal_shape: Thu Lunch: 1 shared parts (want 4±1), no /poli|chapati|bhaat|rice|bhakri/i: Bhaji
- meal_shape: Fri Lunch: 1 shared parts (want 4±1): Varan bhaat
- meal_shape: Sat Lunch: 1 shared parts (want 4±1), no /poli|chapati|bhaat|rice|bhakri/i: Chicken rassa
- meal_shape: Sun Lunch: 1 shared parts (want 4±1), no /poli|chapati|bhaat|rice|bhakri/i: Amti
- meal_shape: Thu Dinner: 1 shared parts (want 2±1), no /bhakri|poli|chapati|roti/i: Pithla
- meal_shape: Fri Dinner: 1 shared parts (want 2±1), no /bhakri|poli|chapati|roti/i: Usal
- meal_shape: Sat Dinner: 1 shared parts (want 2±1), no /bhakri|poli|chapati|roti/i: Fish fry
- meal_shape: Sun Dinner: 1 shared parts (want 2±1), no /bhakri|poli|chapati|roti/i: Fish fry
- judge: Chicken rassa is on Saturday although it is a Sunday dish, and fish fry is on Sunday although it is Saturday-only; Wed-Fri lunches are a single dish instead of poli, bhaji, varan bhaat and koshimbir.
- planner said unmet: Bhaji repeats on 3 days (Mon, Wed, Thu): only 6 lunch dishes known; Varan bhaat repeats on 3 days (Mon, Tue, Fri): only 6 lunch dishes known; Usal repeats on 3 days (Mon, Wed, Fri): only 5 dinner dishes known

### h7-menon
- personal_dish_freq: Eggs [Nikhil] on 7 days (Mon,Tue,Wed,Thu,Fri,Sat,Sun), at most 3
- personal_dish_freq: Oats [Tanya] on 6 days (Mon,Wed,Thu,Fri,Sat,Sun), at most 3
- personal_dish_freq: Smoothie [Tanya] on 5 days (Tue,Wed,Thu,Fri,Sat), at most 3
- personal_dish_eaters: Wed Breakfast: Oats (Tanya's) given to Nikhil
- personal_dish_eaters: Thu Breakfast: Smoothie (Tanya's) given to Nikhil
- personal_dish_eaters: Fri Breakfast: Oats (Tanya's) given to Nikhil
- personal_dish_eaters: Sat Breakfast: Smoothie (Tanya's) given to Nikhil
- personal_dish_eaters: Sun Breakfast: Eggs (Nikhil's) given to Tanya
- dish_frequency: Biryani (rarely) planned on Thu,Fri
- judge: Personal dishes given to the wrong person: Oats and Smoothie (Tanya-only) are assigned to Nikhil, Eggs (Nikhil-only) to Tanya on Sunday, and Biryani, a rare dish, is served twice.

### h8-banerjee
- personal_dish_freq: Veg torkari [Gita] on 7 days (Mon,Tue,Wed,Thu,Fri,Sat,Sun), at most 3
- dish_frequency: Luchi (Sun) planned on Wed,Thu,Sun
- dish_frequency: Alur dom (Sun) planned on Wed,Thu,Fri
- dish_frequency: Maacher jhol (usually) planned on Mon,Thu
- dish_frequency: Kosha mangsho (Sun) planned on Wed,Fri
- meal_shape: Mon Breakfast: 4 shared parts (want 2±1): Toast, Egg, Muri, Chire bhaja
- meal_shape: Tue Breakfast: 4 shared parts (want 2±1): Toast, Egg, Muri, Chire bhaja
- meal_shape: Fri Breakfast: 1 shared parts (want 2±1), no /toast|muri|chire|luchi|bread/i: Alur dom
- meal_shape: Wed Lunch: 2 shared parts (want 5±1), no /bhaat|rice/i: Dal, Kosha mangsho, Veg torkari
- meal_shape: Thu Lunch: 2 shared parts (want 5±1), no /bhaat|rice/i: Dal, Maacher jhol, Veg torkari
- meal_shape: Fri Lunch: 2 shared parts (want 5±1), no /bhaat|rice/i: Dal, Kosha mangsho, Veg torkari
- meal_shape: Sat Lunch: 1 shared parts (want 5±1), no /bhaat|rice/i: Dal, Veg torkari
- meal_shape: Sun Lunch: 1 shared parts (want 5±1), no /bhaat|rice/i: Dal, Veg torkari
- judge: Sunday luchi-alur dom and kosha mangsho are on Wed, Thu and Fri instead, while Sunday has only luchi and dal. Bhaat is missing from most lunches.
- planner said unmet: Alur dom repeats on 3 days (Wed, Thu, Fri): only 6 breakfast dishes known; Chire bhaja repeats on 3 days (Mon, Tue, Sat): only 6 breakfast dishes known; Luchi repeats on 3 days (Wed, Thu, Sun): only 6 breakfast dishes known

## Top failure kinds

- meal_shape: 27
- dish_frequency: 18
- personal_dish_freq: 12
- personal_dish_eaters: 12
- soft_frequency: 2
