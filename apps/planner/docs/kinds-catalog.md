# Meal Planner: dish kinds catalog

This is the review copy of `server/kinds.json`. Please read it as a cook would and mark anything wrong.

**A kind** is a dish family a household names when it says what is on the plate: Idli, Dosa, Poha, Roti, Dal, Sabzi, Rice, Curd. Each meal is a template of kinds: breakfast [Dosa], lunch [Rice, Dal, Sabzi, Curd], dinner [Roti, Sabzi]. A kind is never a vague slot like "breakfast dish" or "main".

**An item** is one variant of a kind: Dosa has plain dosa, masala dosa, rava dosa, set dosa; Sabzi has bhindi, aloo gobi, lauki, tinda, beans poriyal.

**How it is used.**
- *Setup*: the family's own words ("aloo sabzi", "poriyal", "pappu", "kande pohe") are matched to a kind through the kind's and items' other names (aka), so the family's plates become templates of kinds.
- *Planning*: for variety the planner picks a NEW item of the same kind for the slot (another dry vegetable for a dry vegetable), and repeats an item only when all fitting items have been used. It prefers items of the family's cuisines; an item's own cuisines narrow it further.
- *Food rules and allergies*: each item lists its **ingredients as usually made in an Indian home**, and its contents (in brackets) are derived from them. Each ingredient is **main** (the dish is not itself without it: mooli in mooli thepla, onion in kanda poha, paneer in paneer bhurji) or one the dish can be made **without** (a garnish, tempering or add-in: cashews in rava upma, peanuts and onion in vegetable poha, ghee on top). For each person at the table and each of their hard rules or allergies: a main ingredient that breaks it means the dish is not theirs (they get another item); only ingredients it can be made without mean the dish is fine for them, with a note "make without cashews for Anya" (decided 21). A family's own recipe can still say otherwise.

**Reading the headings**: Kind, its other names, its cuisines, its place on the plate (staple, main, side, complete = a whole plate alone, sweet, snack, drink), and the meals new items of it may be suggested at (a sub-kind or item that differs says so). A family's own dish is planned at whatever meal they eat it; at a meal outside these it stays their fixed dish and nothing new is suggested in its place. Contents shared by every item of the kind are said once on the heading line ("all: rice"); each item's brackets show the rest. A diet is shown on an item only in kinds that mix veg and non-veg.

## What we suggest

The planner proposes only items marked **Suggested** (to every family) or **Suggested in its region** (to a family whose cuisines include the item's). Items under **Recognised only** stay in the catalog so setup understands a family's words, and are planned when the family already eats them.

1. **A variant is suggested when it changes the main ingredient and needs no special equipment.** A different vegetable, lentil, flour or grain that can simply be bought counts: rava, ragi and oats idli; sattu and bajra variants; rice, ragi, wheat and corn puttu; bhindi, lauki, tinda.
2. **A regional style of a dish is suggested within its region** (`regional: true`, with the item's own cuisines): Chettinad or kadai chicken, macher jhol, Goan fish curry, Gujarati dal, varan, amti, cholar dal, the regional kadhis, ker sangri, haak. The family's cuisine profile is filled automatically from the cuisines of the catalog items their own dishes match, plus regions they mention, and is shown in the read-back for them to correct.
3. **A variant that changes the flavour base is suggested**: another tempering, sauce, masala, filling or topping (dal tadka and dal fry, masala khichdi, schezwan noodles, pink sauce pasta, Mysore masala or onion dosa, masala chaas, paneer butter masala, butter chicken).
4. **Recognised only = the same dish in another shape, or needing other equipment or its own plate**: thatte, mini (button) or Kanchipuram idli, sambar idli; set dosa, kal dosai, plain uttapam; lachha paratha; sandwich dhokla; the Bengali and Odia pitha shapes; tandoori chicken and chicken tikka (tandoor or oven).
5. **Staples are never suggested.** A household keeps its own roti, rice, bhakri, curd, mudde and puri: never missi roti, makki roti or brown rice.

Contents words: egg, chicken, mutton (incl. goat and lamb), pork, beef, fish, prawn (and other shellfish), onion/garlic, dairy (milk, curd, paneer, ghee, butter, cream), nuts (cashew, almond…), peanut, sugar (added sugar or jaggery), rice (rice, rice batter, poha), wheat (incl. sooji/rava, maida, pav, bread), root veg (potato, carrot, beet, yam, radish…), mushroom, brinjal, karela, coconut, soy.

**Tag families** (`parents` in kinds.json): chicken, mutton, pork and beef are **meat**; fish and prawn are **seafood**. Vegetarian = no meat, no seafood (egg is checked on its own). "No beef" checks beef alone; "fish but no prawn" allows fish and blocks prawn; "no meat" blocks all four meats.

## Breakfast

Breakfast dishes. Many also serve dinner or the tiffin box; the meals are on each heading.

### Idli
aka idly, iddli, idlis; south; complete; breakfast, dinner, tiffin

**Suggested:**
- Idli (idly) [rice]: idli rice, urad dal
- Rava idli (sooji idli) [wheat, dairy, nuts, root veg]: sooji, curd; *without:* cashews, carrot, ghee
- Ghee podi idli (podi idli) [rice, dairy]: idli rice, urad dal, ghee, podi
- Ragi idli [rice]: ragi flour, idli rice, urad dal
- Oats idli [wheat, dairy, nuts, root veg]: oats, sooji, curd; *without:* carrot, cashews

**Recognised only:**
- Kanchipuram idli (kanchipuram kudalai idli) [rice, dairy, nuts; tamil]: idli rice, urad dal; *without:* cashews, ghee
- Mini idli (button idli, cocktail idli) [rice, dairy]: idli rice, urad dal; *without:* ghee
- Thatte idli [rice, dairy; karnataka]: idli rice, urad dal; *without:* ghee
- Sambar idli (sambar dip idli) [rice, onion/garlic, dairy, root veg]: idli rice, urad dal, toor dal; *without:* onion, shallots, ghee

### Dosa
aka dosai, dose, dosey, pesarattu, pesara dosa, moong dal dosa, green gram dosa, adai, adai dosai, adai dosa, uttapam, uthappam, oothappam, uttappa; south; complete; breakfast, dinner, tiffin; veg and non-veg

**Suggested:**
- Plain dosa (sada dosa, dosai) [rice, dairy]: idli rice, urad dal; *without:* ghee
- Masala dosa [rice, root veg, onion/garlic, dairy]: idli rice, urad dal, potato; *without:* onion, ghee
- Mysore masala dosa [rice, root veg, onion/garlic, dairy; karnataka]: idli rice, urad dal, potato, red chilli; *without:* onion, garlic, ghee, butter
- Ghee roast dosa (ghee roast, nei roast) [rice, dairy]: idli rice, urad dal, ghee
- Benne dosa (butter dosa, davangere benne dose) [rice, dairy, root veg; karnataka]: idli rice, urad dal, butter; *without:* potato
- Onion dosa (vengaya dosai) [rice, onion/garlic, dairy, root veg]: idli rice, urad dal, onion; *without:* ghee
- Rava dosa (rava dosai) [rice, wheat, onion/garlic, dairy, nuts, root veg]: sooji, rice flour; *without:* onion, cashews, ghee
- Ragi dosa [rice, onion/garlic, root veg]: ragi flour, idli rice, urad dal; *without:* onion
- Wheat dosa (godhuma dosa, atta dosa) [wheat, onion/garlic, root veg]: atta; *without:* onion, green chilli
- Egg dosa (muttai dosai) [egg; rice, egg, onion/garlic, root veg]: idli rice, urad dal, egg; *without:* onion
- Pesarattu (pesara dosa) [rice, onion/garlic, root veg; andhra]: whole moong, rice; *without:* onion, ginger, green chilli
- Upma pesarattu (MLA pesarattu) [rice, onion/garlic, wheat, nuts, root veg; andhra]: whole moong, rice, sooji; *without:* onion, ginger, cashews
- Adai (adai dosai) [rice, onion/garlic, root veg; tamil/kerala]: rice, toor dal, chana dal, urad dal; *without:* onion, shallots
- Vegetable adai [rice, onion/garlic, root veg; tamil/kerala]: rice, toor dal, chana dal; *without:* carrot, onion, cabbage
- Murungai keerai adai (drumstick leaf adai) [rice, onion/garlic, root veg; tamil/kerala]: rice, toor dal, chana dal, drumstick leaves; *without:* onion
- Onion uttapam (vengaya uthappam) [rice, onion/garlic, dairy, root veg]: idli rice, urad dal, onion; *without:* ghee
- Tomato uttapam [rice, onion/garlic, root veg]: idli rice, urad dal, tomato; *without:* onion
- Mixed vegetable uttapam (veg uttapam) [rice, onion/garlic, root veg]: idli rice, urad dal, tomato, capsicum; *without:* onion, carrot
- Rava uttapam (sooji uttapam) [wheat, dairy, onion/garlic, root veg]: sooji, curd; *without:* onion, tomato
- Podi uttapam [rice, dairy]: idli rice, urad dal, podi; *without:* ghee

**Suggested in its region:**
- Neer dosa [rice, coconut; karnataka]: raw rice, coconut

**Recognised only:**
- Set dosa (sponge dosa) [rice, dairy; karnataka]: idli rice, urad dal, poha; *without:* butter
- Kal dosai (kal dosa) [rice; tamil]: idli rice, urad dal
- Plain uttapam [rice, dairy]: idli rice, urad dal; *without:* ghee

### Upma
aka uppittu, uppumavu, kharabath, upeet, uppuma, khara bath; north, south, west; complete; breakfast, dinner, tiffin; all: root veg

**Suggested:**
- Rava upma (sooji upma, suji upma, uppittu, upeet) [wheat, onion/garlic, nuts, peanut, dairy]: sooji; *without:* cashews, peanuts, onion, ghee, curry leaves
- Vegetable upma (khara bath) [wheat, onion/garlic, nuts, dairy]: sooji, mixed vegetables; *without:* carrot, green peas, onion, cashews, ghee
- Semiya upma (vermicelli upma, shevai upma) [wheat, onion/garlic, nuts]: vermicelli; *without:* onion, carrot, green peas, cashews
- Dalia upma (broken wheat upma, godhuma rava upma, vegetable dalia, namkeen dalia, masala dalia) [wheat, onion/garlic]: broken wheat; *without:* onion, carrot, green peas
- Rice upma (arisi upma, akki tari uppittu) [rice, onion/garlic, coconut]: rice rava; *without:* coconut, onion, urad dal
- Bread upma [wheat, onion/garlic]: bread, tomato; *without:* onion
- Oats upma (masala oats) [onion/garlic]: oats; *without:* carrot, onion, green peas
- Idli upma (leftover idli upma) [rice, onion/garlic]: idli rice, urad dal; *without:* onion, curry leaves
- Sabudana khichdi (sabudana upma, javvarisi upma, sago upma) [peanut; maharashtra/gujarat/north]: sabudana, potato; *without:* peanuts, green chilli

### Poha
aka pohe, aval, avalakki, chira, chire, chuda, atukulu, avil, flattened rice; north, west, south, east, central; complete; breakfast, tiffin, snack; all: rice

**Suggested:**
- Kanda poha (kande pohe, onion poha) [onion/garlic, peanut, root veg; maharashtra]: poha, onion; *without:* peanuts, curry leaves, coriander
- Batata poha (batata pohe, aloo poha) [onion/garlic, peanut, root veg; west]: poha, potato; *without:* onion, peanuts
- Matar poha (peas poha) [onion/garlic, peanut, root veg]: poha, green peas; *without:* onion, peanuts
- Vegetable poha [onion/garlic, peanut, root veg]: poha; *without:* onion, peanuts, potato, carrot, green peas

**Suggested in its region:**
- Indori poha [onion/garlic, peanut, sugar, root veg; central]: poha; *without:* onion, sugar, peanuts, sev
- Dadpe pohe [onion/garlic, coconut, root veg; maharashtra]: poha, coconut; *without:* onion
- Aval upma (poha upma, aval kichadi) [onion/garlic, peanut, root veg; tamil]: poha; *without:* onion, peanuts, curry leaves
- Avalakki oggarane (avalakki) [onion/garlic, peanut, root veg, coconut; karnataka]: poha; *without:* onion, peanuts, coconut
- Aval nanachathu [coconut, sugar; kerala]: poha, coconut, jaggery
- Chire bhaja (chira bhaja) [onion/garlic, peanut, root veg; bengal]: poha; *without:* onion, peanuts
- Doi chire (dahi chura) [dairy, sugar; east]: poha, curd; *without:* sugar, banana

### Paratha
aka parantha, parotha, prantha, porota; north, punjab, west; complete; breakfast, lunch, dinner, tiffin; veg and non-veg; all: dairy, wheat

**Suggested:**
- Aloo paratha [root veg, onion/garlic]: atta, potato; *without:* ghee, butter, onion
- Gobi paratha: atta, cauliflower; *without:* ghee, butter
- Methi paratha: atta, methi; *without:* ghee, curd
- Paneer paratha: atta, paneer; *without:* ghee, butter
- Mooli paratha [root veg]: atta, mooli; *without:* ghee, butter
- Palak paratha: atta, spinach; *without:* ghee
- Pyaaz paratha (onion paratha) [onion/garlic, root veg]: atta, onion; *without:* ghee, butter
- Mixed vegetable paratha (veg paratha) [root veg]: atta, mixed vegetables; *without:* potato, carrot, ghee
- Dal paratha: atta, chana dal; *without:* ghee
- Matar paratha (peas paratha): atta, green peas; *without:* ghee
- Sattu paratha [onion/garlic, root veg; east]: atta, sattu; *without:* onion, garlic, ghee
- Egg paratha (anda paratha) [egg; egg, onion/garlic, root veg]: atta, egg; *without:* onion, ghee
- Keema paratha [non-veg; mutton, onion/garlic, root veg]: atta, mutton keema; *without:* onion, ghee

**Suggested in its region:**
- Sindhi koki (koki) [onion/garlic, root veg; sindhi]: atta; *without:* onion, ghee

**Recognised only:**
- Lachha paratha (plain paratha, tikona paratha): atta, ghee

### Thepla
aka theplu, methi na thepla; gujarat; complete; breakfast, dinner, tiffin, snack; all: dairy, wheat

**Suggested:**
- Methi thepla (methi na thepla): atta, methi; *without:* curd, ghee
- Plain thepla (masala thepla): atta; *without:* curd, ghee
- Dudhi thepla (lauki thepla): atta, lauki; *without:* curd, ghee
- Palak thepla: atta, spinach; *without:* curd, ghee
- Bajra methi thepla: bajra flour, atta, methi; *without:* curd, ghee
- Mooli thepla [root veg]: atta, mooli; *without:* curd, ghee

### Thalipeeth
aka thalipith, thalipeet; maharashtra; complete; breakfast, snack; all: root veg

**Suggested:**
- Bhajani thalipeeth [wheat, rice, onion/garlic, dairy]: jowar flour, rice flour, besan, atta; *without:* onion, butter
- Jowar thalipeeth [onion/garlic]: jowar flour, besan; *without:* onion
- Methi thalipeeth [wheat, rice, onion/garlic]: jowar flour, rice flour, atta, methi; *without:* onion
- Kakdi thalipeeth (cucumber thalipeeth) [rice, onion/garlic]: cucumber, rice flour; *without:* onion
- Sabudana thalipeeth (upvas thalipeeth) [peanut]: sabudana, potato; *without:* peanuts

### Chilla
aka cheela, chila, pudla, puda, poodla; north, west, central; complete; breakfast, dinner, tiffin; all: onion/garlic, root veg

**Suggested:**
- Besan chilla (besan cheela, pudla): besan; *without:* onion, tomato
- Moong dal chilla (moong dal cheela): moong dal; *without:* onion, ginger
- Paneer chilla (stuffed paneer chilla) [dairy]: besan, paneer; *without:* onion
- Rava chilla (sooji chilla) [wheat, dairy]: sooji, curd; *without:* onion
- Oats chilla: oats, besan; *without:* onion
- Vegetable chilla: besan, mixed vegetables; *without:* onion, carrot

### Appam
aka aappam, hoppers, palappam, vellayappam; kerala, tamil; main; breakfast, dinner; all: sugar, coconut

**Suggested:**
- Appam (palappam, vellayappam) [rice]: raw rice, coconut; *without:* sugar
- Kallappam [rice]: raw rice, coconut; *without:* sugar
- Rava appam (instant appam) [wheat]: sooji, coconut; *without:* sugar

### Puttu
aka pittu, puttu kadala; kerala; main; breakfast, dinner; all: coconut

**Suggested:**
- Rice puttu (puttu, arisi puttu) [rice]: rice flour, coconut
- Wheat puttu (gothambu puttu) [wheat]: wheat flour, coconut
- Ragi puttu: ragi flour, coconut
- Corn puttu (cholam puttu, maize puttu): corn, coconut

### Idiyappam
aka string hoppers, nool puttu, sevai, noolappam, shavige, ottu shavige; kerala, tamil, karnataka; main; breakfast, dinner, tiffin

**Suggested:**
- Idiyappam (rice idiyappam, string hoppers, nool puttu, noolappam) [rice, coconut]: rice flour; *without:* coconut
- Ragi idiyappam (ragi shavige) [rice, coconut]: ragi flour, rice flour; *without:* coconut
- Wheat idiyappam (gothambu idiyappam) [wheat, coconut]: wheat flour; *without:* coconut
- Lemon sevai (elumichai sevai, lemon shavige) [rice, peanut]: rice flour, lemon; *without:* peanuts
- Coconut sevai (thengai sevai) [rice, coconut, nuts]: rice flour, coconut; *without:* cashews

### Kozhukattai
aka kolukattai, modak, kadubu, undrallu; south, maharashtra; snack; breakfast, snack; all: rice, coconut

**Suggested:**
- Pidi kozhukattai: rice flour; *without:* coconut
- Ulundu kozhukattai (uppu kozhukattai): rice flour, urad dal; *without:* coconut
- Sweet kozhukattai (modak, ukadiche modak, modakam, kadubu) [sugar, dairy]: rice flour, coconut, jaggery; *without:* ghee

**Recognised only:**
- Ammini kozhukattai: rice flour; *without:* coconut

### Akki roti
aka akki rotti, rotti, rice roti; karnataka; complete; breakfast, dinner

**Suggested:**
- Akki roti (akki rotti) [rice, onion/garlic, coconut, root veg]: rice flour; *without:* onion, coconut, dill
- Ragi roti (ragi rotti) [onion/garlic, root veg]: ragi flour; *without:* onion
- Sabsige akki roti (dill akki roti) [rice, onion/garlic, coconut, root veg]: rice flour, dill; *without:* onion, coconut

**Suggested in its region:**
- Pathiri (ari pathiri) [rice, coconut; kerala]: rice flour; *without:* coconut

### Paniyaram
aka kuzhi paniyaram, paddu, gunta ponganalu, appe, guliyappa; south, maharashtra; complete; breakfast, tiffin, snack

**Suggested:**
- Kara paniyaram (kuzhi paniyaram, paddu, gunta ponganalu) [rice, onion/garlic, root veg]: idli rice, urad dal; *without:* onion
- Sweet paniyaram (inippu paniyaram) [rice, sugar]: idli rice, urad dal, jaggery
- Rava appe [wheat, dairy, onion/garlic, root veg]: sooji, curd; *without:* onion
- Ragi paniyaram [rice, onion/garlic, root veg]: ragi flour, idli rice; *without:* onion

### Puri
aka poori, luchi, bhatura, pakwan; north, west, east, south; staple; breakfast, lunch, dinner, tiffin; all: wheat

**Recognised only:**
- Puri (poori): atta
- Masala puri (ajwain puri): atta
- Palak puri: atta, spinach
- Luchi [bengal]: maida
- Radhaballabhi [bengal]: maida, urad dal
- Bedmi puri [north]: atta, urad dal
- Bhatura (bhature) [dairy]: maida, curd
- Pakwan [sindhi]: maida
- Mangalore buns (banana puri) [sugar, dairy; karnataka]: maida, banana, sugar, curd

### Kachori
aka kochuri, kachauri; north, rajasthan, east; snack; breakfast, snack; all: wheat

**Suggested:**
- Khasta kachori (dal kachori): maida, moong dal
- Pyaaz kachori (onion kachori) [onion/garlic, root veg; rajasthan]: maida, onion
- Matar kachori (koraishutir kochuri): maida, green peas
- Aloo kachori [root veg]: maida, potato

**Suggested in its region:**
- Hing kochuri [bengal]: maida, urad dal

### Porridge
aka oats, oatmeal, dalia, daliya, ragi malt, kanji; north, west, south, continental; complete; breakfast; all: dairy, sugar

**Suggested:**
- Oats porridge (oatmeal) [continental]: oats, milk; *without:* sugar
- Overnight oats [nuts; continental]: oats, milk; *without:* sugar, honey, almonds
- Sweet milk dalia (meetha dalia, dalia porridge) [wheat, nuts; north/west]: broken wheat, milk, sugar; *without:* almonds, cashews
- Ragi malt (ragi porridge, ragi java, ragi kanji) [south]: ragi flour, milk; *without:* jaggery

**Suggested in its region:**
- Lapsi (fada ni lapsi) [wheat, nuts; gujarat]: broken wheat, ghee, jaggery; *without:* almonds

### Cereal
aka cornflakes, muesli, chocos; continental; complete; breakfast; all: dairy, sugar

**Suggested:**
- Cornflakes with milk (cornflakes): cornflakes, milk; *without:* sugar
- Muesli [nuts, wheat]: muesli, milk; *without:* almonds, honey
- Chocos [wheat]: chocos, milk
- Wheat flakes [wheat]: wheat flakes, milk; *without:* sugar

### Toast
aka bread toast, bread butter; continental; complete; breakfast, tiffin, snack; veg and non-veg; all: wheat

**Suggested:**
- Bread butter toast (butter toast) [dairy]: bread, butter
- Bread jam (jam toast) [sugar, dairy]: bread, jam; *without:* butter
- French toast [egg; egg, dairy, sugar]: bread, egg, milk; *without:* sugar
- Masala toast [dairy, onion/garlic, root veg]: bread, potato; *without:* onion, butter, cheese
- Peanut butter toast [peanut, sugar]: bread, peanut butter; *without:* honey
- Cheese toast (chilli cheese toast) [dairy]: bread, cheese; *without:* butter

### Sandwich
aka sandwiches; continental, west; complete; breakfast, tiffin, snack; veg and non-veg; all: dairy, wheat

**Suggested:**
- Vegetable sandwich (veg sandwich) [onion/garlic, root veg]: bread, cucumber, tomato; *without:* butter, mint, potato, onion
- Grilled cheese sandwich (cheese sandwich): bread, cheese; *without:* butter
- Paneer sandwich [onion/garlic, root veg]: bread, paneer; *without:* butter, onion
- Aloo sandwich (potato sandwich) [root veg]: bread, potato; *without:* butter
- Corn sandwich (corn cheese sandwich): bread, sweet corn; *without:* cheese, butter
- Chutney sandwich: bread, mint, coriander; *without:* butter
- Egg sandwich (egg mayo sandwich) [egg; egg]: bread, egg; *without:* butter
- Chicken sandwich [non-veg; chicken, egg]: bread, chicken; *without:* egg, butter

**Suggested in its region:**
- Bombay sandwich [root veg, onion/garlic; maharashtra]: bread, potato, cucumber, tomato; *without:* butter, beetroot, onion, cheese

### Dhokla
aka khaman, farsan, muthia, muthiya, handvo, handwa; gujarat; snack; breakfast, tiffin, snack

**Suggested:**
- Khaman dhokla (khaman) [sugar]: besan; *without:* sugar
- Khatta dhokla (idada) [rice, dairy]: rice, urad dal, curd
- Rava dhokla (sooji dhokla) [wheat, dairy]: sooji, curd
- Moong dal dhokla: moong dal
- Khandvi [dairy, coconut]: besan, buttermilk; *without:* coconut
- Methi muthia (muthia, muthiya) [wheat, dairy, sugar]: atta, besan, methi; *without:* sugar, curd
- Dudhi muthia (lauki muthia) [wheat, dairy, sugar]: atta, besan, lauki; *without:* sugar, curd
- Handvo (mixed dal handvo) [rice, dairy, sugar]: rice, toor dal, curd, lauki; *without:* sugar
- Rava handvo (sooji handvo) [wheat, dairy]: sooji, curd, lauki
- Vegetable handvo [rice, dairy, root veg, sugar]: rice, toor dal, curd, mixed vegetables; *without:* carrot, sugar

**Recognised only:**
- Sandwich dhokla [rice, dairy]: rice, urad dal, curd

### Pav meal
aka pav bhaji, bhaji pav, misal, misal pav, usal pav, vada pav, dabeli, pav; maharashtra, gujarat; complete; breakfast, dinner, snack; all: wheat

#### Pav meal → Misal
aka misal pav, usal pav; maharashtra

**Suggested:**
- Misal pav [onion/garlic, root veg]: pav, matki; *without:* onion, sev
- Puneri misal [onion/garlic, rice, sugar, root veg]: pav, matki, poha; *without:* onion, jaggery, sev
- Kolhapuri misal [onion/garlic, coconut, root veg]: pav, matki; *without:* onion, garlic, dry coconut, sev
- Usal pav [onion/garlic, root veg]: pav, white peas; *without:* onion, garlic

#### Pav meal → Pav bhaji
aka bhaji pav, masala pav; maharashtra, gujarat; suggested at dinner, snack

**Suggested:**
- Pav bhaji [dairy, root veg, onion/garlic]: pav, mixed vegetables, potato; *without:* butter, onion, garlic
- Jain pav bhaji [dairy]: pav, mixed vegetables, raw banana; *without:* butter
- Masala pav [dairy, onion/garlic, root veg]: pav, tomato; *without:* onion, butter

#### Pav meal → Vada pav
aka dabeli; maharashtra, gujarat; suggested at snack

**Suggested:**
- Dabeli (kutchi dabeli) [root veg, peanut, sugar, onion/garlic; gujarat]: pav, potato; *without:* peanuts, sweet chutney, onion
- Vada pav [root veg, onion/garlic; maharashtra]: pav, potato, besan; *without:* garlic

### Pitha
aka pithe, pitta; east, bengal, odisha, assam; snack; breakfast, snack; all: rice

**Suggested:**
- Patishapta [wheat, coconut, sugar, dairy; bengal]: rice flour, maida, coconut, jaggery; *without:* khoa
- Chitoi pitha (chitol pitha) [bengal]: rice flour
- Til pitha [sugar; assam]: rice flour, sesame, jaggery
- Chakuli pitha [odisha]: rice, urad dal

**Recognised only:**
- Puli pitha [coconut, sugar; bengal]: rice flour, coconut, jaggery
- Bhapa pitha [coconut, sugar]: rice flour, coconut, jaggery
- Enduri pitha [coconut, sugar; odisha]: rice, urad dal, coconut, jaggery
- Poda pitha [coconut, sugar; odisha]: rice, urad dal, coconut, jaggery

## Lunch and dinner: staples

These come every day their plate has them (staple: yes). The planner does not rotate them for variety.

### Roti
aka chapati, phulka, fulka, rotli, poli, chapathi, chapatti; north, south, west, east, central; staple (every day its plate has it); lunch, dinner, tiffin

**Recognised only:**
- Phulka (fulka) [wheat]: atta
- Chapati (chapathi, rotli, poli, tawa roti) [wheat, dairy]: atta; *without:* ghee
- Ghee roti (ghee chapati, tup poli) [wheat, dairy]: atta, ghee
- Missi roti [wheat, onion/garlic, root veg]: atta, besan; *without:* onion
- Makki ki roti (makki di roti, makai roti) [dairy; punjab]: makki atta; *without:* butter
- Multigrain roti (multigrain chapati) [wheat]: multigrain atta

### Bhakri
aka bhakar, rotla, rotlo, jolada rotti, jowar roti, bajra roti, millet roti; maharashtra, gujarat, rajasthan, karnataka; staple (every day its plate has it); lunch, dinner

**Recognised only:**
- Jowar bhakri (jowar roti, jolada rotti): jowar flour
- Bajra bhakri (bajra roti, bajra no rotlo, bajre ki roti): bajra flour
- Nachni bhakri (ragi bhakri, ragi roti (flat)): ragi flour
- Rice bhakri (tandlachi bhakri, akki bhakri) [rice; maharashtra/goa]: rice flour
- Wheat bhakri (ghau ni bhakri) [wheat; gujarat]: atta

### Rice
aka chawal, bhaat, bhat, sadam, annam, anna, plain rice; north, south, west, east; staple (every day its plate has it); lunch, dinner

**Recognised only:**
- Steamed rice (plain rice, chawal, bhaat, sadam, annam) [rice]: rice
- Jeera rice [rice, dairy]: basmati rice, cumin; *without:* ghee
- Brown rice: brown rice
- Matta rice (kerala red rice, rosematta, red rice) [kerala]: matta rice

### Curd
aka dahi, thayir, mosaru, perugu, doi, yogurt; north, south, west, east; side (every day its plate has it); lunch, dinner

**Recognised only:**
- Curd (dahi, thayir, mosaru, perugu, doi) [dairy]: curd

### Mudde
aka ragi mudde, ragi sangati, ragi ball, sankati; karnataka, andhra; staple (every day its plate has it); lunch, dinner

**Recognised only:**
- Ragi mudde (ragi ball, ragi kali): ragi flour
- Ragi sangati (sankati) [rice; andhra]: ragi flour, rice

## Lunch and dinner: dals and rice curries

Dal covers every lentil and legume dal, rajma and chole included. Rice curry covers the curries eaten with rice: sambar, rasam, kuzhambu, kootu, kadhi.

### Dal
aka daal, pappu, paruppu, amti, varan, dali, dalma, tovve, bele, parippu, lentils, rajma, chole, chhole, chana, usal, lobia, ghugni, kadala curry, kabuli chana, rassa, pithla, pitla, zunka, jhunka; north, south, west, east, central; main; lunch, dinner

#### Dal → Dal
aka daal, dal tadka, dal fry; north, central, east

**Suggested:**
- Moong dal (yellow moong dal, dhuli moong) [onion/garlic, dairy, root veg]: moong dal; *without:* onion, garlic, ghee
- Masoor dal (red lentil dal) [onion/garlic, root veg]: masoor dal; *without:* onion, garlic, tomato
- Toor dal (arhar dal, tuvar dal) [onion/garlic, dairy, root veg]: toor dal; *without:* tomato, onion, garlic, ghee
- Chana dal (chane ki dal) [onion/garlic, dairy, root veg]: chana dal; *without:* onion, garlic, ghee
- Mixed dal (panchratna dal) [onion/garlic, dairy, root veg]: toor dal, moong dal, masoor dal, chana dal; *without:* onion, garlic, ghee
- Dal tadka (yellow dal tadka) [dairy, onion/garlic, root veg]: toor dal; *without:* ghee, onion, garlic, tomato
- Dal fry [onion/garlic, root veg]: toor dal, tomato; *without:* onion, garlic
- Palak dal (dal palak) [onion/garlic, root veg]: toor dal, spinach; *without:* onion, garlic
- Lauki chana dal [onion/garlic, root veg]: chana dal, lauki; *without:* onion, garlic

**Suggested in its region:**
- Panchmel dal [dairy, onion/garlic, root veg; rajasthan]: toor dal, moong dal, chana dal, urad dal, masoor dal; *without:* ghee, onion, garlic
- Dal makhani [dairy, onion/garlic, root veg; punjab]: urad dal, rajma, butter, cream; *without:* onion, garlic
- Khatti dal [onion/garlic, root veg; andhra]: toor dal, tamarind; *without:* garlic
- Sai bhaji (sindhi sai bhaji) [onion/garlic, root veg, brinjal; sindhi]: chana dal, spinach, dill, mixed vegetables; *without:* onion, garlic, potato, brinjal

#### Dal → Rajma/Chole
aka rajma, chole, chana, usal, lobia, ghugni, kadala curry, legume curry; north, south, west, east

**Suggested:**
- Rajma (rajma masala, rajma chawal) [onion/garlic, root veg]: rajma, tomato; *without:* onion, garlic, ginger
- Chole (chana masala, chhole, kabuli chana) [onion/garlic, root veg]: chickpeas, tomato; *without:* onion, garlic, ginger
- Kala chana curry (kale chane) [onion/garlic, root veg]: kala chana, tomato; *without:* onion, garlic
- Lobia (lobia masala, chawli) [onion/garlic, root veg]: lobia, tomato; *without:* onion, garlic
- Safed matar (ragda, white peas curry) [onion/garlic, root veg]: white peas; *without:* onion, garlic
- Matki usal [onion/garlic, coconut, root veg; maharashtra]: matki; *without:* onion, garlic, coconut
- Moong usal [onion/garlic, coconut, root veg; maharashtra]: whole moong; *without:* onion, garlic, coconut
- Sprouts curry (moong sprouts curry) [onion/garlic, root veg]: sprouts, tomato; *without:* onion, garlic

**Suggested in its region:**
- Jammu rajma (chitra rajma) [onion/garlic, root veg; kashmir]: rajma, tomato; *without:* onion, garlic
- Pindi chole [onion/garlic, root veg; punjab]: chickpeas; *without:* onion, garlic, ginger
- Ghugni [onion/garlic, root veg, coconut; east]: white peas; *without:* onion, garlic, potato, coconut
- Vatana usal [onion/garlic, coconut, root veg; maharashtra]: white peas; *without:* onion, garlic, coconut
- Kadala curry [onion/garlic, coconut, root veg; kerala]: kala chana, coconut; *without:* shallots, garlic
- Chana ghassi [coconut; karnataka]: kala chana, coconut

#### Dal → Pappu
aka pappu; andhra

**Suggested:**
- Tomato pappu [onion/garlic, root veg; andhra]: toor dal, tomato; *without:* onion, garlic
- Mamidikaya pappu (mango dal) [onion/garlic, root veg; andhra]: toor dal, raw mango; *without:* onion, garlic
- Dosakaya pappu [onion/garlic, root veg; andhra]: toor dal, cucumber; *without:* onion, garlic

**Suggested in its region:**
- Muddha pappu (plain pappu) [dairy; andhra]: toor dal; *without:* ghee
- Palakura pappu (spinach pappu) [onion/garlic, root veg; andhra]: toor dal, spinach; *without:* garlic, onion

#### Dal → Amti/Varan
aka amti, aamti, varan; maharashtra

**Suggested in its region:**
- Varan (varan bhaat dal) [dairy; maharashtra]: toor dal; *without:* ghee
- Amti (katachi amti, toor dal amti) [sugar, coconut; maharashtra]: toor dal, kokum, jaggery; *without:* coconut

#### Dal → Pithla/Zunka
aka pithla, pitla, zunka, jhunka; maharashtra

**Suggested:**
- Pithla (pitla) [onion/garlic, root veg; maharashtra]: besan; *without:* onion, garlic
- Zunka (jhunka) [onion/garlic, root veg; maharashtra]: besan, onion; *without:* garlic

#### Dal → Gujarati dal
aka khatti meethi dal; gujarat

**Suggested in its region:**
- Gujarati dal (gujarati toor dal, khatti meethi dal) [sugar, peanut; gujarat]: toor dal, jaggery; *without:* peanuts

#### Dal → Bengali dal
aka cholar dal, musur dal, bhaja moong dal; bengal

**Suggested in its region:**
- Cholar dal [coconut, sugar, dairy; bengal]: chana dal; *without:* coconut, ghee, sugar, raisins
- Bengali masoor dal (musur dal) [onion/garlic, root veg; bengal]: masoor dal; *without:* onion, garlic
- Sona moong dal (bhaja moong dal) [dairy; bengal]: moong dal; *without:* ghee

#### Dal → Dalma
aka dalma; odisha

**Suggested in its region:**
- Dalma [root veg, brinjal, coconut; odisha]: toor dal, mixed vegetables, raw papaya, pumpkin; *without:* potato, brinjal, coconut

#### Dal → Paruppu
aka paruppu, parippu, tovve, bele; tamil, kerala, karnataka

**Suggested in its region:**
- Paruppu (paruppu kadayal) [dairy; tamil]: toor dal; *without:* ghee
- Kerala parippu curry (parippu) [coconut, onion/garlic, dairy, root veg; kerala]: moong dal, coconut; *without:* shallots, ghee
- Tovve [dairy; karnataka]: toor dal; *without:* ghee

### Rice curry
aka sambar, sambhar, rasam, kuzhambu, kulambu, kootu, kadhi, kadi, saaru, charu, pulusu, mor kuzhambu, majjige huli, pulissery, huli, gojju; south, north, west, sindhi; main; breakfast, lunch, dinner, tiffin

#### Rice curry → Sambar
aka sambhar, huli; south

**Suggested:**
- Drumstick sambar (murungakkai sambar) [onion/garlic, root veg; south]: toor dal, drumstick, tamarind; *without:* shallots
- Mixed vegetable sambar [onion/garlic, root veg; south]: toor dal, mixed vegetables, tamarind; *without:* potato, carrot, shallots
- Onion sambar (vengaya sambar, small onion sambar) [onion/garlic, root veg; south]: toor dal, shallots, tamarind
- Radish sambar (mullangi sambar) [onion/garlic, root veg; south]: toor dal, mooli, tamarind; *without:* onion
- Brinjal sambar (kathirikai sambar) [onion/garlic, brinjal, root veg; south]: toor dal, brinjal, tamarind; *without:* onion
- Pumpkin sambar (parangikai sambar) [onion/garlic, root veg; south]: toor dal, pumpkin, tamarind; *without:* onion
- Okra sambar (vendakkai sambar) [onion/garlic, root veg; south]: toor dal, okra, tamarind; *without:* onion
- Tiffin sambar (idli sambar) [onion/garlic, root veg; south]: toor dal, moong dal, tomato; *without:* onion

**Suggested in its region:**
- Arachuvitta sambar [coconut, onion/garlic, root veg; tamil]: toor dal, coconut, tamarind; *without:* shallots
- Udupi sambar (huli) [coconut, sugar; karnataka]: toor dal, coconut, jaggery
- Kerala sambar [coconut, onion/garlic, root veg; kerala]: toor dal, coconut, mixed vegetables; *without:* shallots

#### Rice curry → Rasam
aka saaru, charu; south; suggested at lunch, dinner

**Suggested:**
- Tomato rasam (thakkali rasam, tomato charu) [onion/garlic, root veg; south]: tomato, tamarind; *without:* garlic, toor dal
- Pepper rasam (milagu rasam) [onion/garlic, root veg; south]: pepper, tamarind; *without:* garlic
- Lemon rasam (elumichai rasam) [south]: lemon, toor dal
- Garlic rasam (poondu rasam) [onion/garlic, root veg; south]: garlic, tamarind; *without:* toor dal
- Paruppu rasam (dal rasam) [south]: toor dal, tomato, tamarind
- Pineapple rasam [sugar; south]: pineapple, toor dal; *without:* sugar
- Jeera rasam (jeeragam rasam) [south]: cumin, tamarind; *without:* toor dal
- Kollu rasam (horsegram rasam) [onion/garlic, root veg; south]: horse gram; *without:* garlic

**Suggested in its region:**
- Mysore rasam [coconut, dairy; karnataka]: toor dal, tomato, coconut; *without:* ghee
- Udupi saaru (udupi rasam) [sugar; karnataka]: toor dal, tomato; *without:* jaggery

#### Rice curry → Kuzhambu/Pulusu
aka kuzhambu, kulambu, pulusu, gojju; tamil, andhra, karnataka; suggested at lunch, dinner

**Suggested:**
- Vatha kuzhambu (vathal kuzhambu) [onion/garlic, root veg; tamil]: tamarind; *without:* shallots, garlic
- Kara kuzhambu [onion/garlic, root veg; tamil]: tamarind; *without:* shallots, garlic
- Poondu kuzhambu (garlic kuzhambu) [onion/garlic, root veg; tamil]: garlic, tamarind; *without:* shallots
- Ennai kathirikai kuzhambu [brinjal, onion/garlic, root veg; tamil]: brinjal, tamarind; *without:* shallots, garlic
- Paruppu urundai kuzhambu [onion/garlic, root veg; tamil]: toor dal, chana dal, tamarind; *without:* shallots, garlic
- Puli kuzhambu (tamarind kuzhambu) [onion/garlic, root veg; tamil]: tamarind; *without:* shallots, garlic
- Sorakaya pulusu [onion/garlic, root veg; andhra]: lauki, tamarind; *without:* onion
- Bendakaya pulusu (okra pulusu) [onion/garlic, root veg; andhra]: okra, tamarind; *without:* onion
- Pineapple gojju [sugar; karnataka]: pineapple, tamarind, jaggery
- Hagalakai gojju (bitter gourd gojju) [karela, sugar; karnataka]: karela, tamarind, jaggery

**Suggested in its region:**
- Mukkala pulusu [onion/garlic, root veg, brinjal, sugar; andhra]: mixed vegetables, tamarind; *without:* brinjal, potato, onion, jaggery

#### Rice curry → Kootu
aka koottu; tamil, kerala; suggested at lunch, dinner

**Suggested:**
- Chow chow kootu [coconut; tamil/kerala]: chow chow, moong dal, coconut
- Poricha kootu [coconut; tamil/kerala]: mixed vegetables, moong dal, coconut
- Keerai kootu (spinach kootu) [coconut; tamil/kerala]: amaranth, moong dal, coconut
- Pudalangai kootu (snake gourd kootu) [coconut; tamil/kerala]: snake gourd, moong dal, coconut
- Kathirikai kootu (brinjal kootu) [coconut, brinjal; tamil/kerala]: brinjal, moong dal, coconut
- Cabbage kootu [coconut; tamil/kerala]: cabbage, moong dal, coconut

#### Rice curry → Kadhi
aka kadi; north, west, sindhi; suggested at lunch, dinner

**Suggested:**
- Punjabi kadhi pakora (kadhi pakoda) [dairy, onion/garlic, root veg; punjab]: curd, besan; *without:* onion, garlic
- Gujarati kadhi [dairy, sugar; gujarat]: curd, besan; *without:* sugar
- Sindhi kadhi [root veg; sindhi]: besan, mixed vegetables, tamarind; *without:* potato, drumstick

**Suggested in its region:**
- Rajasthani kadhi [dairy; rajasthan]: curd, besan
- Maharashtrian kadhi (taak kadhi) [dairy; maharashtra]: curd, besan

#### Rice curry → Mor kuzhambu/Pulissery
aka mor kuzhambu, majjige huli, pulissery, moru curry; tamil, karnataka, kerala; suggested at lunch, dinner

**Suggested:**
- Mor kuzhambu [dairy, coconut; tamil]: curd, coconut

**Suggested in its region:**
- Majjige huli [dairy, coconut; karnataka]: curd, coconut
- Pulissery (moru curry) [dairy, coconut; kerala]: curd, coconut

## Lunch and dinner: vegetables

### Sabzi
aka sabji, subzi, sukhi sabzi, dry sabzi, bhaji, poriyal, porial, thoran, torkari, palya, vepudu, upkari, shaak, fugath, sukke, bhaja, bharta, chokha, pitika, bharit, bharwa, bharli, stuffed vegetable; north, south, west, east, central; main; lunch, dinner, tiffin; veg and non-veg

#### Sabzi → Sabzi
aka sukhi sabzi, bhaji, shaak, sukke, fugath; north, west, central

**Suggested:**
- Bhindi sabzi (bhindi fry, bhindi masala, vendakkai poriyal) [onion/garlic, root veg]: okra; *without:* onion
- Aloo gobi [root veg, onion/garlic]: potato, cauliflower; *without:* onion, garlic
- Jeera aloo (aloo jeera) [root veg]: potato
- Aloo methi [root veg, onion/garlic]: potato, methi; *without:* garlic
- Aloo bhaji (puri bhaji, batata bhaji, batatyachi bhaji) [root veg, onion/garlic]: potato; *without:* onion
- Lauki sabzi (doodhi sabzi, ghiya): lauki, tomato
- Tinda sabzi [onion/garlic, root veg]: tinda; *without:* onion
- Turai sabzi (tori, ridge gourd sabzi) [onion/garlic, root veg]: turai; *without:* onion
- Parwal sabzi (potol) [onion/garlic, root veg]: parwal; *without:* onion
- Karela sabzi (karela fry) [karela, onion/garlic, root veg]: karela; *without:* onion
- Cabbage sabzi (patta gobhi) [onion/garlic, root veg]: cabbage; *without:* green peas, onion
- Beans sabzi (french beans sabzi): french beans
- Gajar matar [root veg]: carrot, green peas
- Kaddu sabzi (khatta meetha kaddu, pumpkin sabzi) [sugar]: pumpkin; *without:* jaggery
- Arbi sabzi (arbi fry, colocasia) [root veg]: arbi
- Baingan aloo (aloo baingan) [brinjal, root veg, onion/garlic]: brinjal, potato; *without:* onion
- Aloo shimla mirch (capsicum aloo) [root veg]: potato, capsicum
- Kundru sabzi (tondli, tindora, tindora nu shaak) [onion/garlic, root veg]: ivy gourd; *without:* onion
- Mixed vegetable sabzi (mix veg sukhi) [root veg, onion/garlic]: mixed vegetables; *without:* potato, carrot, onion
- Suran sabzi (yam sabzi) [root veg]: elephant foot yam
- Methi bhaji (methichi bhaji) [onion/garlic, root veg; maharashtra]: methi; *without:* onion, garlic
- Paneer bhurji [dairy, onion/garlic, root veg]: paneer; *without:* onion, tomato

**Suggested in its region:**
- Ker sangri [rajasthan]: ker, sangri
- Haak (haak saag) [kashmir]: collard greens
- Bateta nu shaak [root veg, sugar; gujarat]: potato; *without:* sugar

#### Sabzi → Poriyal/Thoran
aka poriyal, porial, thoran, upkari, palya; south

**Suggested:**
- Carrot poriyal [root veg, coconut; south]: carrot; *without:* coconut
- Beetroot poriyal (beetroot thoran) [root veg, coconut; south]: beetroot; *without:* coconut
- Vazhakkai poriyal (raw banana fry, kachche kele ki sabzi) [south]: raw banana
- Keerai poriyal (spinach poriyal, cheera thoran) [coconut; south]: amaranth; *without:* coconut

**Suggested in its region:**
- Beans poriyal (beans thoran, beans palya) [coconut; south]: french beans; *without:* coconut
- Cabbage thoran (cabbage poriyal) [coconut; south]: cabbage, coconut
- Urulaikizhangu roast (potato roast, aloo fry) [root veg; south]: potato
- Senai roast (yam fry, suran fry) [root veg; south]: elephant foot yam
- Kovakkai fry [onion/garlic, root veg; south]: ivy gourd; *without:* onion

#### Sabzi → Vepudu
aka vepudu; andhra

**Suggested in its region:**
- Bendakaya vepudu [onion/garlic, root veg; andhra]: okra; *without:* onion
- Dondakaya vepudu [onion/garlic, peanut, root veg; andhra]: ivy gourd; *without:* onion, peanuts

#### Sabzi → Torkari/Ghonto
aka torkari, ghonto, chorchori, posto; bengal, odisha

**Suggested:**
- Mochar ghonto [root veg, coconut; bengal]: banana flower; *without:* potato, coconut

**Suggested in its region:**
- Shukto [karela, brinjal, root veg, dairy, sugar; bengal]: karela, raw banana; *without:* brinjal, sweet potato, milk, sugar, mustard paste
- Chorchori [root veg, brinjal; bengal]: mixed vegetables; *without:* potato, brinjal
- Lau ghonto [dairy; bengal]: lauki; *without:* milk
- Aloo posto [root veg; bengal]: potato, poppy seeds
- Bandhakopir torkari [root veg; bengal]: cabbage; *without:* potato, green peas

#### Sabzi → Bhaja
aka bhaja; bengal, odisha

**Suggested:**
- Begun bhaja [brinjal]: brinjal
- Alu bhaja (jhuri alu bhaja) [root veg]: potato
- Potol bhaja: parwal
- Uchhe bhaja (korola bhaja) [karela]: karela
- Kumro bhaja (pumpkin bhaja): pumpkin
- Beguni [brinjal]: brinjal, besan

#### Sabzi → Bharta/Chokha
aka bharta, chokha, pitika, bhorta, bharit, pora; north, east, bengal, assam, maharashtra, northeast

**Suggested:**
- Baingan bharta [brinjal, onion/garlic, root veg]: brinjal; *without:* onion, garlic, tomato
- Aloo chokha [root veg, onion/garlic; east]: potato; *without:* onion, mustard oil
- Tomato chokha [onion/garlic, root veg; east]: tomato; *without:* garlic, onion

**Suggested in its region:**
- Baingan chokha [brinjal, onion/garlic, root veg; east]: brinjal; *without:* garlic, onion
- Aloo pitika [root veg, onion/garlic; assam]: potato; *without:* onion
- Begun pora [brinjal, onion/garlic, root veg; bengal]: brinjal; *without:* onion
- Vangyache bharit (baingan bharit) [brinjal, onion/garlic, peanut, root veg; maharashtra]: brinjal; *without:* onion, peanuts
- Eromba [non-veg; fish, root veg; northeast]: dry fish, mixed vegetables; *without:* potato

#### Sabzi → Bharwa
aka bharwa, bharli, gutti, bharela, stuffed; north, west, andhra

**Suggested:**
- Bharwa bhindi (stuffed bhindi) [onion/garlic, root veg]: okra; *without:* onion
- Bharwa baingan (stuffed baingan) [brinjal, onion/garlic, root veg]: brinjal; *without:* onion
- Bharwa karela (stuffed karela) [karela, onion/garlic, root veg]: karela; *without:* onion
- Bharwa tinda [onion/garlic, root veg]: tinda; *without:* onion
- Bharwa parwal [onion/garlic, root veg]: parwal; *without:* onion
- Stuffed capsicum (bharwa shimla mirch) [root veg, onion/garlic]: capsicum, potato; *without:* onion

**Suggested in its region:**
- Gutti vankaya [brinjal, onion/garlic, peanut, root veg; andhra]: brinjal, peanuts; *without:* onion
- Bharli vangi [brinjal, onion/garlic, peanut, coconut, root veg; maharashtra]: brinjal, peanuts, coconut; *without:* onion
- Bharela ringan bateta [brinjal, root veg, peanut, sugar; gujarat]: brinjal, potato, peanuts; *without:* sugar

### Gravy
aka gravy sabzi, rasedar sabzi, tari wali sabzi, masala, korma, kurma, kofta, kofta curry, salan, rassa, dalna, shaak, paneer, paneer sabzi, avial, olan, erissery, kalan, theeyal, stew, ishtu; north, south, west, east; main; lunch, dinner

#### Gravy → Curry
aka rasedar sabzi, tari wali sabzi, masala, rassa, shaak, salan; north, west, east

**Suggested:**
- Aloo matar [root veg, onion/garlic]: potato, green peas, tomato; *without:* onion, garlic
- Aloo tamatar (aloo rasedar) [root veg]: potato, tomato
- Aloo palak (palak aloo) [root veg, onion/garlic]: potato, spinach; *without:* onion, garlic
- Dum aloo [root veg, dairy, onion/garlic]: potato, curd; *without:* onion, garlic
- Matar mushroom [mushroom, onion/garlic, root veg]: mushroom, green peas; *without:* onion, garlic
- Mushroom masala [mushroom, onion/garlic, root veg]: mushroom, tomato; *without:* onion, garlic
- Mix veg curry (mixed vegetable curry) [root veg, onion/garlic]: mixed vegetables, tomato; *without:* potato, carrot, onion, garlic
- Baingan masala [brinjal, onion/garlic, root veg]: brinjal, tomato; *without:* onion, garlic
- Methi matar malai [dairy, nuts, onion/garlic, root veg]: methi, green peas, cream, cashews; *without:* onion
- Kathal sabzi (jackfruit curry, echorer dalna) [onion/garlic, root veg]: jackfruit; *without:* onion, garlic, potato
- Soya chunks curry (soya curry) [soy, onion/garlic, root veg]: soya chunks, tomato; *without:* onion, garlic
- Sarson da saag (sarson ka saag) [dairy, onion/garlic, root veg; punjab]: mustard greens, spinach; *without:* butter, garlic, onion
- Gatte ki sabzi [dairy, onion/garlic, root veg; rajasthan]: besan, curd; *without:* onion, garlic
- Papad ki sabzi [dairy; rajasthan]: papad, curd
- Nadru yakhni [dairy, root veg; kashmir]: lotus stem, curd

**Suggested in its region:**
- Kashmiri dum aloo [root veg, dairy; kashmir]: potato, curd
- Sev tameta (sev tameta nu shaak) [onion/garlic, sugar, root veg; gujarat]: sev, tomato; *without:* onion, sugar
- Undhiyu [root veg, brinjal, coconut, peanut, sugar, wheat, onion/garlic; gujarat]: mixed vegetables, sweet potato, yam, brinjal, atta, methi; *without:* peanuts, coconut, sugar, garlic
- Santula [root veg, brinjal; odisha]: mixed vegetables, raw papaya; *without:* potato, brinjal
- Papaya khar (khar) [assam]: raw papaya
- Khatkhate [coconut, root veg; goa]: mixed vegetables, coconut, kokum; *without:* sweet potato, yam

#### Gravy → Paneer
aka paneer sabzi, paneer gravy; north

**Suggested:**
- Palak paneer (saag paneer) [dairy, onion/garlic, root veg]: paneer, spinach; *without:* onion, garlic, cream
- Matar paneer [dairy, onion/garlic, root veg]: paneer, green peas, tomato; *without:* onion, garlic
- Paneer butter masala [dairy, nuts, sugar, onion/garlic, root veg]: paneer, tomato, butter, cream; *without:* cashews, sugar, onion, garlic
- Kadai paneer [dairy, onion/garlic, root veg]: paneer, capsicum, tomato; *without:* onion, garlic
- Shahi paneer [dairy, nuts, onion/garlic, root veg]: paneer, cream, cashews; *without:* onion, garlic, almonds
- Paneer tikka masala [dairy, onion/garlic, root veg]: paneer, curd, tomato; *without:* onion, garlic, cream
- Paneer do pyaza [dairy, onion/garlic, root veg]: paneer, onion; *without:* garlic, tomato
- Achari paneer [dairy, onion/garlic, root veg]: paneer, curd; *without:* onion, garlic
- Paneer kofta [dairy, onion/garlic, root veg]: paneer, tomato; *without:* onion, garlic, cream

#### Gravy → Kofta
aka kofta curry, kofte; north

**Suggested:**
- Lauki kofta [onion/garlic, root veg]: lauki, besan, tomato; *without:* onion, garlic
- Malai kofta [dairy, nuts, root veg, onion/garlic]: paneer, potato, cream, cashews; *without:* onion, garlic, raisins
- Palak kofta [onion/garlic, root veg]: spinach, besan, tomato; *without:* onion, garlic
- Raw banana kofta (kachche kele ke kofte) [onion/garlic, root veg]: raw banana, besan, tomato; *without:* onion, garlic

#### Gravy → Kurma
aka korma, kurma; south

**Suggested in its region:**
- Vegetable kurma (veg korma) [root veg, coconut, nuts, onion/garlic; south]: mixed vegetables, coconut; *without:* cashews, potato, carrot, onion, garlic

#### Gravy → Dalna
aka dalna; bengal

**Suggested in its region:**
- Aloo dalna [root veg, dairy, sugar; bengal]: potato, tomato; *without:* ghee, sugar
- Potol dalna [root veg, dairy, sugar; bengal]: parwal; *without:* potato, ghee, sugar

#### Gravy → Kerala curry
aka avial, aviyal, olan, erissery, kalan, theeyal, stew, ishtu; kerala

**Suggested:**
- Aviyal (avial) [coconut, dairy, root veg; kerala]: mixed vegetables, coconut, curd; *without:* yam, drumstick, carrot
- Olan [coconut; kerala]: pumpkin, lobia, coconut milk
- Erissery [coconut; kerala]: pumpkin, coconut; *without:* lobia
- Kalan [coconut, dairy, root veg; kerala]: raw banana, yam, curd, coconut
- Kootu curry [coconut, root veg; kerala]: kala chana, raw banana, coconut; *without:* yam
- Vegetable stew (ishtu) [coconut, root veg, onion/garlic; kerala]: potato, coconut milk; *without:* carrot, onion, green peas
- Ulli theeyal (theeyal) [coconut, onion/garlic, root veg; kerala]: shallots, coconut, tamarind
- Pavakka theeyal [karela, coconut, onion/garlic, root veg; kerala]: karela, coconut, tamarind; *without:* shallots
- Kappa puzhukku (kappa, tapioca mash) [coconut, root veg; kerala]: tapioca, coconut

## Lunch and dinner: rice dishes

Khichdi, Biryani and Flavoured rice are each a whole plate on their own (with papad, raita or pickle at most); a khichdi night rotates only khichdis, a biryani lunch only biryanis, and a plate may hold two different flavoured rices. Pulao is not a whole plate: it stands where plain rice stands and needs a dal or curry beside it.

### Pulao
aka pulav, pilaf, ghee rice, neychoru; north, south, west, east, kashmir; main; lunch, dinner, tiffin; veg and non-veg; all: rice

**Suggested:**
- Vegetable pulao (veg pulao) [dairy, onion/garlic, root veg]: basmati rice, mixed vegetables; *without:* carrot, potato, onion, ghee
- Matar pulao (peas pulao) [dairy, onion/garlic, root veg]: basmati rice, green peas; *without:* ghee, onion
- Paneer pulao [dairy, onion/garlic, root veg]: basmati rice, paneer; *without:* ghee, onion
- Chana pulao [onion/garlic, root veg]: basmati rice, chickpeas; *without:* onion
- Yakhni pulao (mutton yakhni pulao) [non-veg; mutton, dairy, onion/garlic, root veg]: basmati rice, mutton; *without:* curd, onion, ghee
- Chicken pulao [non-veg; chicken, dairy, onion/garlic, root veg]: basmati rice, chicken; *without:* curd, onion, ghee

**Suggested in its region:**
- Kashmiri pulao [dairy, nuts, sugar; kashmir]: basmati rice, ghee, milk, sugar; *without:* cashews, almonds, raisins, saffron
- Ghee rice (neychoru) [dairy, nuts, onion/garlic, root veg; kerala]: basmati rice, ghee; *without:* cashews, onion, raisins
- Coconut milk pulao (thengai paal sadam) [coconut, onion/garlic, root veg; tamil]: basmati rice, coconut milk; *without:* onion, mixed vegetables
- Basanti pulao (mishti pulao) [dairy, nuts, sugar; bengal]: basmati rice, ghee, sugar; *without:* cashews, raisins
- Tawa pulao [dairy, root veg, onion/garlic; maharashtra]: rice, mixed vegetables, tomato; *without:* butter, potato, onion

### Biryani
aka biriyani, dum biryani; north, south, west, east; complete; lunch, dinner; veg and non-veg; all: onion/garlic, rice, root veg

**Suggested:**
- Veg biryani (vegetable biryani) [dairy]: basmati rice, mixed vegetables; *without:* curd, fried onions, ghee, potato
- Paneer biryani [dairy]: basmati rice, paneer; *without:* curd, fried onions, ghee
- Mushroom biryani [mushroom, dairy]: basmati rice, mushroom; *without:* curd, fried onions
- Chicken biryani (hyderabadi chicken biryani) [non-veg; chicken, dairy]: basmati rice, chicken; *without:* curd, fried onions, ghee
- Mutton biryani [non-veg; mutton, dairy]: basmati rice, mutton; *without:* curd, fried onions, ghee
- Egg biryani [egg; egg, dairy]: basmati rice, egg; *without:* curd, fried onions, ghee
- Fish biryani [non-veg; fish, dairy]: basmati rice, fish; *without:* curd, fried onions
- Prawn biryani [non-veg; prawn]: basmati rice, prawns; *without:* fried onions

**Suggested in its region:**
- Kolkata biryani [non-veg; chicken, mutton, egg, dairy; bengal]: basmati rice, chicken, mutton; *without:* potato, egg, curd, fried onions, ghee
- Malabar biryani (thalassery biryani) [non-veg; chicken, dairy, nuts; kerala]: rice, chicken; *without:* ghee, cashews, fried onions, raisins
- Ambur biryani (dindigul biryani) [non-veg; chicken, mutton, dairy; tamil]: rice, chicken, mutton; *without:* curd, onion

### Khichdi
aka khichri, khichuri, khichadi, pongal, ven pongal, khara pongal, huggi, pongali; north, south, west, east; complete; breakfast, lunch, dinner; all: dairy

#### Khichdi → Khichdi
aka khichri, khichuri, khichadi; north, west, east; suggested at lunch, dinner

**Suggested:**
- Moong dal khichdi [rice]: rice, moong dal; *without:* ghee
- Masala khichdi [rice, onion/garlic, root veg]: rice, moong dal, mixed vegetables; *without:* potato, onion, ghee
- Vegetable khichdi [rice, root veg]: rice, moong dal, mixed vegetables; *without:* potato, carrot, ghee
- Bajra khichdi [rajasthan]: bajra, moong dal; *without:* ghee
- Dalia khichdi [wheat]: broken wheat, moong dal; *without:* ghee

**Suggested in its region:**
- Gujarati khichdi (toor dal khichdi) [rice; gujarat]: rice, toor dal; *without:* ghee
- Bhuna khichuri (bhoger khichuri) [rice, root veg; bengal]: rice, moong dal; *without:* potato, cauliflower, ghee

#### Khichdi → Pongal
aka ven pongal, khara pongal, huggi, pongali; south; suggested at breakfast, dinner

**Suggested:**
- Ven pongal (khara pongal, ghee pongal, huggi) [rice, nuts; south]: rice, moong dal, ghee; *without:* cashews, pepper
- Rava pongal [wheat, nuts; south]: sooji, moong dal, ghee; *without:* cashews
- Millet pongal (thinai pongal, varagu pongal, samai pongal) [nuts; south]: millet, moong dal, ghee; *without:* cashews
- Oats pongal [nuts; south]: oats, moong dal; *without:* ghee, cashews
- Godhumai rava pongal (broken wheat pongal, dalia pongal) [wheat, nuts; south]: broken wheat, moong dal, ghee; *without:* cashews

### Flavoured rice
aka variety rice, chitranna, kalanda sadam, mixed rice, bath, pulihora, sadam; south, odisha; complete; lunch, dinner, tiffin; all: rice

**Suggested:**
- Lemon rice (chitranna, elumichai sadam, nimmakaya pulihora) [peanut]: rice, lemon; *without:* peanuts
- Tamarind rice (puliyogare, puliyodharai, pulihora) [peanut, sugar]: rice, tamarind; *without:* peanuts, jaggery
- Coconut rice (thengai sadam, kayi anna) [coconut, nuts]: rice, coconut; *without:* cashews
- Tomato rice (thakkali sadam, tomato bath) [onion/garlic, root veg]: rice, tomato; *without:* onion, garlic
- Bisi bele bath [dairy, nuts, root veg; karnataka]: rice, toor dal, mixed vegetables; *without:* ghee, cashews, potato
- Vangi bath [brinjal, nuts; karnataka]: rice, brinjal; *without:* cashews
- Mango rice (mangai sadam, mavinakayi chitranna) [peanut]: rice, raw mango; *without:* peanuts
- Sesame rice (ellu sadam): rice, sesame
- Pudina rice (mint rice) [onion/garlic, root veg]: rice, mint; *without:* onion
- Capsicum rice: rice, capsicum

**Suggested in its region:**
- Pakhala (pakhala bhata) [dairy; odisha]: rice; *without:* curd

### Fried rice
aka chinese rice; indo-chinese; complete; lunch, dinner, tiffin; veg and non-veg; all: onion/garlic, rice, root veg, soy

**Suggested:**
- Veg fried rice: rice, mixed vegetables; *without:* soy sauce, spring onion, garlic, carrot
- Schezwan fried rice: rice, mixed vegetables, red chilli; *without:* soy sauce, garlic, spring onion
- Paneer fried rice [dairy]: rice, paneer; *without:* soy sauce, garlic, spring onion
- Egg fried rice [egg; egg]: rice, egg; *without:* soy sauce, garlic, spring onion
- Chicken fried rice [non-veg; chicken, egg]: rice, chicken; *without:* soy sauce, garlic, egg

## Lunch and dinner: non-veg

### Egg
aka eggs, anda, muttai, egg curry, anda curry; north, south, west, east; main; breakfast, lunch, dinner, tiffin, snack; egg; all: egg

#### Egg → Eggs
aka omelette, bhurji, anda, boiled eggs; north, south, west, east; suggested at breakfast, dinner, tiffin, snack

**Suggested:**
- Masala omelette (omelette, anda omelette) [onion/garlic, root veg]: egg; *without:* onion, tomato
- Plain omelette: egg
- Egg bhurji (anda bhurji) [onion/garlic, root veg]: egg; *without:* onion, tomato
- Boiled eggs: egg
- Half fry (fried egg, bull's eye): egg
- Bread omelette [wheat, onion/garlic, root veg]: bread, egg; *without:* onion

**Suggested in its region:**
- Akuri [onion/garlic, dairy, root veg; parsi]: egg; *without:* onion, butter, cream
- Egg podimas (muttai podimas) [onion/garlic, root veg; tamil]: egg; *without:* onion, curry leaves
- Scrambled eggs [dairy; continental]: egg; *without:* butter, milk

#### Egg → Egg curry
aka anda curry, muttai kuzhambu, dimer dalna, egg masala; north, south, west, east; suggested at lunch, dinner

**Suggested:**
- Egg curry (anda curry) [onion/garlic, root veg]: egg, tomato; *without:* onion, garlic
- Egg masala [onion/garlic, root veg]: egg, tomato; *without:* onion, garlic

**Suggested in its region:**
- Egg roast (mutta roast) [onion/garlic, root veg; kerala]: egg; *without:* onion, garlic
- Egg stew [onion/garlic, coconut, root veg; kerala]: egg, coconut milk; *without:* potato, onion, carrot
- Dimer dalna (dimer jhol) [onion/garlic, root veg; bengal]: egg, potato; *without:* onion, garlic
- Muttai kuzhambu [onion/garlic, root veg; tamil]: egg, tamarind; *without:* shallots, garlic

### Chicken
aka chicken, murgh, kozhi, kodi, chicken curry, chicken fry, chicken dry; north, south, west, east; main; lunch, dinner, snack; nonveg; all: chicken, onion/garlic, root veg

#### Chicken → Curry
aka chicken curry, murgh, kozhi curry, kodi kura, chicken gravy; north, south, west, east; suggested at lunch, dinner

**Suggested:**
- Chicken curry (home-style chicken curry): chicken, tomato; *without:* onion, garlic
- Butter chicken (murgh makhani) [dairy, nuts, sugar]: chicken, tomato, butter, cream; *without:* cashews, sugar, garlic
- Chicken korma [dairy, nuts]: chicken, curd, cashews; *without:* onion, garlic
- Chicken do pyaza: chicken, onion; *without:* garlic
- Chicken saagwala (palak chicken): chicken, spinach; *without:* onion, garlic

**Suggested in its region:**
- Kadai chicken [north/punjab]: chicken, capsicum, tomato; *without:* onion, garlic
- Chettinad chicken [coconut; tamil]: chicken, coconut; *without:* shallots, garlic
- Nadan chicken curry (kerala chicken curry) [coconut; kerala]: chicken, coconut milk; *without:* shallots, garlic
- Chicken stew [coconut; kerala]: chicken, coconut milk; *without:* potato, carrot, onion
- Andhra chicken curry (kodi kura) [andhra]: chicken; *without:* onion, garlic
- Kolhapuri chicken [coconut; maharashtra]: chicken, dry coconut; *without:* onion, garlic
- Chicken xacuti [coconut; goa]: chicken, coconut; *without:* onion, garlic
- Murgir jhol [bengal]: chicken; *without:* potato, onion, garlic
- Kosha murgi [dairy; bengal]: chicken, curd; *without:* onion, garlic

#### Chicken → Fry/Dry
aka chicken fry, chicken dry, sukka, roast, varuval; north, south, west, east

**Suggested:**
- Chicken fry (kozhi varuval): chicken; *without:* onion, garlic
- Chicken 65 [egg, dairy, rice]: chicken; *without:* curd, egg, garlic, rice flour
- Pepper chicken: chicken, pepper; *without:* onion, garlic

**Suggested in its region:**
- Chicken sukka (kori sukka) [coconut; karnataka]: chicken, coconut; *without:* onion, garlic
- Chicken ghee roast [dairy; karnataka]: chicken, ghee; *without:* garlic, curd
- Kerala chicken roast [kerala]: chicken; *without:* onion, garlic

**Recognised only:**
- Tandoori chicken [dairy]: chicken, curd; *without:* garlic
- Chicken tikka [dairy]: chicken, curd; *without:* garlic, capsicum, onion

#### Chicken → Keema
aka chicken keema, chicken mince; north, west; suggested at lunch, dinner

**Suggested:**
- Chicken keema: chicken; *without:* onion, garlic, green peas

### Mutton
aka mutton, gosht, mangsho, lamb, goat, keema, kheema, mince; north, south, west, east; main; lunch, dinner; nonveg; all: mutton

#### Mutton → Curry
aka mutton curry, gosht, mangsho, mangshor jhol; north, south, west, east

**Suggested:**
- Mutton curry (home-style mutton curry, goat curry) [onion/garlic, root veg]: mutton, tomato; *without:* onion, garlic
- Mutton korma [onion/garlic, dairy, nuts, root veg]: mutton, curd, cashews; *without:* onion, garlic, almonds
- Dalcha [onion/garlic, root veg; andhra]: mutton, chana dal, tamarind; *without:* onion, garlic

**Suggested in its region:**
- Rogan josh [onion/garlic, dairy, root veg; kashmir]: mutton, curd; *without:* onion, garlic
- Mutton yakhni [dairy; kashmir]: mutton, curd
- Laal maas [onion/garlic, dairy, root veg; rajasthan]: mutton, red chilli, curd; *without:* garlic, onion
- Kosha mangsho [onion/garlic, dairy, root veg; bengal]: mutton, curd; *without:* onion, garlic, potato
- Mangshor jhol [onion/garlic, root veg; bengal]: mutton; *without:* potato, onion, garlic
- Mutton stew [onion/garlic, coconut, root veg; kerala]: mutton, coconut milk; *without:* potato, carrot, onion
- Tambda rassa (kolhapuri mutton) [onion/garlic, coconut, root veg; maharashtra]: mutton, dry coconut; *without:* onion, garlic
- Dhansak [onion/garlic, brinjal, sugar, root veg; parsi]: mutton, toor dal, mixed vegetables; *without:* brinjal, pumpkin, onion, garlic, jaggery
- Salli boti [onion/garlic, root veg, sugar; parsi]: mutton, tomato, jaggery; *without:* onion, garlic, potato

#### Mutton → Fry/Dry
aka mutton fry, sukka, roast; south

**Suggested in its region:**
- Mutton sukka [onion/garlic, coconut, root veg; karnataka]: mutton, coconut; *without:* onion, garlic
- Kerala mutton roast [onion/garlic, root veg; kerala]: mutton; *without:* onion, garlic

#### Mutton → Keema
aka kheema, qeema, mince; north, west

**Suggested:**
- Keema matar [onion/garlic, root veg]: mutton keema, green peas; *without:* onion, garlic
- Keema aloo (aloo keema) [onion/garlic, root veg]: mutton keema, potato; *without:* onion, garlic
- Keema pav [onion/garlic, wheat, dairy, root veg; maharashtra]: mutton keema, pav; *without:* onion, garlic, butter

### Pork
aka pork curry, sorpotel, vindaloo, pandi curry; goa, northeast, karnataka; main; lunch, dinner; nonveg; all: pork, onion/garlic, root veg

**Suggested:**
- Pork curry: pork; *without:* onion, garlic

**Suggested in its region:**
- Pork vindaloo [sugar; goa]: pork, garlic, vinegar; *without:* onion, sugar
- Sorpotel [goa]: pork; *without:* onion, garlic
- Pandi curry (coorg pork curry) [karnataka]: pork; *without:* onion, garlic
- Smoked pork with bamboo shoot (naga pork) [northeast]: pork, bamboo shoot; *without:* garlic
- Pork with akhuni (pork with axone) [soy; northeast]: pork, akhuni; *without:* garlic, tomato

### Fish & seafood
aka fish, machli, meen, maach, mach, seafood, prawns, jhinga, chingri, kolambi, royyalu, eral, shrimp; north, south, west, east; main; lunch, dinner, snack; nonveg

#### Fish & seafood → Fish curry
aka macher jhol, meen curry, meen kuzhambu, chepala pulusu, ambot tik, tenga, machli curry; north, south, west, east; suggested at lunch, dinner

**Suggested:**
- Fish masala curry (machli curry, machli ka salan) [fish, onion/garlic, root veg]: fish, tomato; *without:* onion, garlic

**Suggested in its region:**
- Macher jhol (maacher jhol) [fish, onion/garlic, root veg; bengal]: fish, tomato; *without:* potato, onion
- Shorshe maach (shorshe ilish, mustard fish) [fish; bengal]: hilsa, mustard paste
- Doi maach [fish, dairy, onion/garlic, sugar, root veg; bengal]: rohu, curd; *without:* onion, garlic, sugar
- Meen kuzhambu (meen kulambu) [fish, onion/garlic, root veg; tamil]: fish, tamarind; *without:* shallots, garlic
- Kerala fish curry (meen curry, kudampuli fish curry) [fish, onion/garlic, coconut, root veg; kerala]: fish, kokum; *without:* coconut, shallots, garlic
- Fish moilee (meen molee) [fish, onion/garlic, coconut, root veg; kerala]: fish, coconut milk; *without:* onion, garlic
- Goan fish curry [fish, onion/garlic, coconut, root veg; goa]: fish, coconut; *without:* onion, garlic
- Ambot tik [fish, onion/garlic, root veg; goa]: fish, tamarind; *without:* onion, garlic
- Malvani fish curry [fish, onion/garlic, coconut, root veg; maharashtra]: fish, coconut; *without:* onion, garlic
- Fish gassi (meen gassi) [fish, onion/garlic, coconut, root veg; karnataka]: fish, coconut; *without:* onion, garlic
- Chepala pulusu [fish, onion/garlic, root veg; andhra]: fish, tamarind; *without:* onion, garlic
- Masor tenga [fish; assam]: fish, tomato; *without:* lemon
- Machha besara [fish, onion/garlic, root veg; odisha]: fish, mustard paste; *without:* garlic

#### Fish & seafood → Fish fry
aka maach bhaja, meen varuval, tawa fish; north, south, west, east

**Suggested:**
- Masala fish fry (tawa fish fry) [fish, onion/garlic, root veg]: fish; *without:* garlic, onion
- Rava fish fry [fish, wheat]: fish, sooji

**Suggested in its region:**
- Meen varuval (meen varuthathu) [fish, onion/garlic, root veg; south]: fish; *without:* garlic, shallots
- Maach bhaja [fish; bengal]: fish
- Amritsari fish [fish, onion/garlic, egg, root veg; punjab]: fish, besan; *without:* egg, garlic
- Bombil fry (bombay duck fry) [fish, wheat, rice; maharashtra]: bombil, rice flour, sooji
- Pomfret fry (paplet fry) [fish, onion/garlic, wheat, root veg; maharashtra/goa]: pomfret, sooji; *without:* garlic

#### Fish & seafood → Prawn
aka prawns, jhinga, chingri, kolambi, royyalu, eral, shrimp; north, south, west, east; suggested at lunch, dinner

**Suggested:**
- Prawn curry (eral kuzhambu, kolambi curry) [prawn, onion/garlic, coconut, root veg]: prawns, coconut; *without:* onion, garlic
- Prawn masala [prawn, onion/garlic, root veg]: prawns, tomato; *without:* onion, garlic
- Prawn fry (prawn rava fry, kolambi fry) [prawn, onion/garlic, root veg]: prawns; *without:* garlic, onion

**Suggested in its region:**
- Chingri malai curry [prawn, onion/garlic, coconut, root veg; bengal]: prawns, coconut milk; *without:* onion, garlic
- Prawn balchao [prawn, onion/garlic, sugar, root veg; goa]: prawns, red chilli; *without:* garlic, onion, sugar
- Prawn ghee roast [prawn, onion/garlic, dairy, root veg; karnataka]: prawns, ghee; *without:* garlic
- Royyala iguru [onion/garlic, prawn, root veg; andhra]: prawns; *without:* onion, garlic

## Indo-Chinese and continental (eaten at home)

### Noodles
aka chowmein, hakka noodles, maggi, instant noodles; indo-chinese; complete; lunch, dinner, tiffin, snack; veg and non-veg; all: onion/garlic, wheat, root veg

**Suggested:**
- Hakka noodles (veg chowmein) [soy]: noodles, cabbage, capsicum; *without:* soy sauce, garlic, spring onion, carrot
- Schezwan noodles [soy]: noodles, red chilli; *without:* soy sauce, garlic, cabbage
- Chilli garlic noodles [soy]: noodles, garlic, red chilli; *without:* soy sauce
- Maggi (instant noodles): noodles; *without:* onion
- Vegetable maggi (masala maggi): noodles, mixed vegetables; *without:* onion, carrot
- Egg noodles (egg chowmein) [egg; egg, soy]: noodles, egg; *without:* soy sauce, garlic
- Chicken noodles (chicken chowmein) [non-veg; chicken, soy]: noodles, chicken; *without:* soy sauce, garlic

### Pasta
aka macaroni; continental; complete; lunch, dinner, tiffin; veg and non-veg; all: wheat

**Suggested:**
- White sauce pasta [dairy, onion/garlic, root veg]: pasta, milk, butter, maida; *without:* cheese, garlic
- Red sauce pasta [onion/garlic, root veg]: pasta, tomato; *without:* garlic, onion
- Pink sauce pasta [dairy, onion/garlic, root veg]: pasta, tomato, milk; *without:* cream, garlic, cheese
- Masala pasta (indian-style pasta) [onion/garlic, root veg]: pasta, tomato; *without:* onion, garlic, capsicum
- Macaroni (vegetable macaroni) [onion/garlic, root veg]: macaroni, tomato; *without:* onion, garlic
- Mac and cheese [dairy]: macaroni, cheese, milk, butter
- Pesto pasta [dairy, nuts, onion/garlic, root veg]: pasta, basil, cheese, cashews; *without:* garlic
- Chicken pasta [non-veg; chicken, dairy, onion/garlic, root veg]: pasta, chicken; *without:* cream, cheese, garlic

### Manchurian
aka chilli, chinese, gobi manchurian, dry chilli; indo-chinese; main; dinner, snack; veg and non-veg; all: onion/garlic, root veg, soy

**Suggested:**
- Veg manchurian [wheat]: cabbage, maida; *without:* carrot, soy sauce, garlic, onion
- Gobi manchurian [wheat]: cauliflower, maida; *without:* soy sauce, garlic, onion
- Chilli paneer [dairy, wheat]: paneer, capsicum; *without:* soy sauce, garlic, onion, maida
- Chilli mushroom [mushroom]: mushroom, capsicum; *without:* soy sauce, garlic, onion
- Chilli potato (honey chilli potato) [sugar]: potato; *without:* soy sauce, garlic, honey
- Chilli baby corn: baby corn, capsicum; *without:* soy sauce, garlic, onion
- Chilli chicken [non-veg; chicken, egg, wheat]: chicken, capsicum; *without:* soy sauce, garlic, onion, egg, maida

### Soup
aka shorba; continental, indo-chinese; side; dinner, snack; veg and non-veg; all: onion/garlic, root veg

**Suggested:**
- Tomato soup [dairy; continental]: tomato; *without:* butter, cream, garlic, onion
- Sweet corn soup (veg sweet corn soup) [indo_chinese]: sweet corn; *without:* spring onion
- Hot and sour soup [soy; indo_chinese]: mixed vegetables; *without:* soy sauce, garlic, spring onion
- Manchow soup [soy, wheat; indo_chinese]: mixed vegetables; *without:* soy sauce, garlic, noodles
- Mixed vegetable soup (veg clear soup): mixed vegetables; *without:* carrot, onion, garlic
- Palak soup (spinach soup) [dairy]: spinach; *without:* cream, garlic, onion
- Chicken soup (chicken clear soup) [non-veg; chicken]: chicken; *without:* onion, garlic

## Sides (any meal)

### Raita
aka thayir pachadi, perugu pachadi; north, south, west, east; side; lunch, dinner; all: dairy

**Suggested:**
- Boondi raita: curd, boondi
- Cucumber raita (kheera raita): curd, cucumber
- Onion raita (onion tomato raita) [onion/garlic, root veg]: curd, onion
- Mixed vegetable raita [onion/garlic, root veg]: curd, cucumber, tomato; *without:* onion
- Mint raita (pudina raita): curd, mint
- Pineapple raita [sugar]: curd, pineapple; *without:* sugar
- Aloo raita [root veg]: curd, potato
- Lauki raita: curd, lauki
- Beetroot raita [root veg]: curd, beetroot

**Suggested in its region:**
- Vellarikka pachadi (cucumber pachadi, thayir pachadi) [coconut; south]: curd, cucumber, coconut

### Salad
aka kachumber, koshimbir, kosambari; north, south, west, east; side; lunch, dinner, tiffin, snack

**Suggested:**
- Kachumber (kachumber salad) [onion/garlic, root veg]: cucumber, tomato; *without:* onion, lemon
- Green salad (sliced salad) [onion/garlic, root veg]: cucumber, tomato; *without:* onion, carrot
- Koshimbir (kakdi koshimbir) [peanut, dairy; maharashtra]: cucumber, curd; *without:* peanuts
- Kosambari (hesarubele kosambari) [coconut; karnataka]: moong dal, cucumber; *without:* coconut
- Sprouts salad (moong sprouts salad) [onion/garlic, root veg]: sprouts; *without:* onion, tomato
- Carrot salad [root veg]: carrot
- Beetroot salad [root veg]: beetroot
- Corn salad (sweet corn salad): sweet corn
- Cucumber salad (kakdi salad, kheera salad): cucumber
- Laccha onion (laccha pyaaz, onion salad) [onion/garlic, root veg]: onion
- Fruit chaat (fruit salad): fruit
- Chana salad (chickpea salad) [onion/garlic, root veg]: chickpeas; *without:* onion, tomato

### Chutney
aka chatni, thogayal, thuvaiyal, chammanthi, podi; north, south, west, east; side; breakfast, lunch, dinner, snack

**Suggested:**
- Coconut chutney (thengai chutney, kobbari pachadi) [coconut]: coconut; *without:* curry leaves
- Tomato chutney (thakkali chutney) [onion/garlic, root veg]: tomato; *without:* onion, garlic
- Onion tomato chutney (kara chutney) [onion/garlic, root veg]: onion, tomato; *without:* garlic
- Onion chutney (vengaya chutney) [onion/garlic, root veg]: onion; *without:* garlic
- Mint chutney (pudina chutney, hari chutney) [onion/garlic, root veg]: mint, coriander; *without:* onion, garlic
- Coriander chutney (dhaniya chutney, green chutney): coriander; *without:* lemon
- Peanut chutney (palli chutney, shenga chutney) [peanut, onion/garlic, root veg]: peanuts; *without:* garlic
- Tamarind chutney (imli chutney, saunth) [sugar]: tamarind, jaggery; *without:* dates
- Beerakaya pachadi (ridge gourd chutney) [onion/garlic, root veg; andhra]: turai; *without:* garlic, onion
- Idli podi (gunpowder, milagai podi, chutney powder) [south]: urad dal, chana dal; *without:* sesame

**Suggested in its region:**
- Gongura chutney (gongura pachadi) [onion/garlic, root veg; andhra]: gongura; *without:* garlic, onion
- Dry garlic chutney (lasun chutney) [onion/garlic, coconut, peanut, root veg; maharashtra]: garlic, dry coconut; *without:* peanuts
- Thecha (hirvi mirchi thecha) [onion/garlic, peanut, root veg; maharashtra]: green chilli, garlic; *without:* peanuts
- Shenga chutney pudi (peanut chutney powder) [peanut, onion/garlic, root veg; karnataka]: peanuts; *without:* garlic
- Chammanthi (thenga chammanthi) [coconut, onion/garlic, root veg; kerala]: coconut; *without:* shallots
- Tomato khejur chutney (bengali tomato chutney) [sugar; bengal]: tomato, dates, sugar

### Pickle
aka achar, achaar, oorugai, uppinakayi, avakaya, lonacha; north, south, west, east; side; breakfast, lunch, dinner, tiffin

**Suggested:**
- Mango pickle (aam ka achar, maangai oorugai): raw mango
- Lime pickle (nimbu achar, elumichai oorugai): lime
- Mixed pickle [root veg]: raw mango, lime; *without:* carrot, cauliflower
- Garlic pickle (lehsun achar) [onion/garlic, root veg]: garlic
- Green chilli pickle (hari mirch achar): green chilli
- Amla pickle: amla
- Carrot pickle (gajar achar) [root veg]: carrot

**Suggested in its region:**
- Avakaya [onion/garlic, root veg; andhra]: raw mango; *without:* garlic
- Gongura pickle [onion/garlic, root veg; andhra]: gongura; *without:* garlic
- Sweet mango pickle (chhundo) [sugar; gujarat]: raw mango, sugar

### Papad
aka appalam, pappadam, papadum, happala; north, south, west, east; side; lunch, dinner

**Suggested:**
- Roasted papad: urad papad
- Fried papad: urad papad
- Masala papad [onion/garlic, root veg]: urad papad; *without:* onion, tomato
- Sabudana papad: sabudana
- Rice papad [rice]: rice flour

**Suggested in its region:**
- Appalam [tamil]: urad papad
- Pappadam [kerala]: urad papad

### Buttermilk
aka chaas, chhachh, mor, majjige, taak, lassi; north, south, west, east; drink; lunch, dinner, snack

**Suggested:**
- Chaas (buttermilk, chhachh, taak) [dairy]: buttermilk
- Masala chaas (spiced buttermilk) [dairy]: buttermilk; *without:* mint, coriander
- Sweet lassi [dairy, sugar]: curd, sugar
- Salted lassi [dairy]: curd

**Suggested in its region:**
- Neer mor (majjige) [dairy; south]: buttermilk; *without:* curry leaves
- Sol kadhi [coconut, onion/garlic, root veg; maharashtra/goa]: coconut milk, kokum; *without:* garlic

## Snacks and tiffin box

### Fruit
aka phal, cut fruit; north, south, west, east, continental; snack; breakfast, tiffin, snack

**Suggested:**
- Seasonal fruit (cut fruit): seasonal fruit
- Banana: banana
- Apple slices: apple
- Papaya: papaya
- Fruit custard [dairy, sugar]: milk, fruit, sugar

### Roll
aka frankie, kathi roll, wrap; north, bengal, west; complete; dinner, tiffin, snack; veg and non-veg; all: wheat

**Suggested:**
- Paneer roll (paneer frankie) [dairy, onion/garlic, root veg]: atta, paneer; *without:* onion, capsicum
- Veg frankie [root veg, onion/garlic]: maida, potato, mixed vegetables; *without:* onion
- Aloo roll [root veg]: atta, potato
- Chapati roll (roti roll, sabzi roll): atta, mixed vegetables
- Egg roll (anda roll) [egg; egg, onion/garlic, root veg; bengal]: maida, egg; *without:* onion
- Chicken kathi roll (chicken roll) [non-veg; chicken, onion/garlic, root veg]: maida, chicken; *without:* onion

### Namkeen
aka chivda, mixture, farsan, chakli, murukku, dry snack, makhana, phool makhana, fox nuts, lotus seeds; north, south, west, east; snack; tiffin, snack

**Suggested:**
- Poha chivda (chivda) [rice, peanut, nuts, sugar]: poha; *without:* peanuts, cashews, sugar
- Cornflakes chivda [peanut, nuts, sugar]: cornflakes; *without:* peanuts, cashews, sugar
- Murmura chivda (puffed rice chivda, kurmura) [rice, peanut]: puffed rice; *without:* peanuts
- Mixture (south indian mixture, madras mixture) [peanut]: besan, sev; *without:* peanuts
- Khakhra [wheat; gujarat]: khakhra
- Mathri [wheat; north]: maida
- Chakli (murukku) [rice, dairy]: rice flour; *without:* butter
- Banana chips (nendran chips) [kerala]: raw banana
- Shankarpali (shakkarpara) [wheat, sugar, dairy; maharashtra]: maida, sugar, ghee
- Bhakarwadi [wheat, sugar; maharashtra]: besan, maida; *without:* sugar, sesame
- Masala peanuts [peanut]: peanuts, besan
- Roasted chana (bhuna chana): kala chana
- Roasted makhana [dairy; north]: makhana; *without:* ghee
- Masala makhana [dairy; north]: makhana; *without:* ghee

### Cutlet
aka tikki, patties; north, south, west, east; snack; tiffin, snack; veg and non-veg; all: root veg

**Suggested:**
- Veg cutlet (vegetable cutlet) [wheat]: potato, mixed vegetables; *without:* breadcrumbs, carrot
- Aloo tikki: potato; *without:* green peas
- Poha cutlet [rice]: poha, potato
- Beetroot cutlet [wheat]: beetroot, potato; *without:* breadcrumbs
- Paneer cutlet [dairy, wheat]: paneer, potato; *without:* breadcrumbs
- Fish cutlet [non-veg; fish, wheat, egg]: fish, potato; *without:* breadcrumbs, egg
- Chicken cutlet [non-veg; chicken, wheat, egg]: chicken, potato; *without:* breadcrumbs, egg

### Pakora
aka pakoda, bhajji, bajji, bhajiya, bonda, fritters; north, south, west, east; snack; snack

**Suggested:**
- Onion pakora (kanda bhaji, pyaaz pakoda, onion bajji) [onion/garlic, root veg]: onion, besan
- Aloo pakora (aloo bajji) [root veg]: potato, besan
- Palak pakora: spinach, besan
- Paneer pakora [dairy]: paneer, besan
- Gobi pakora: cauliflower, besan
- Mirchi bajji (mirchi pakora, mirchi vada): green chilli, besan
- Moong dal pakoda [onion/garlic, root veg]: moong dal; *without:* onion
- Bread pakora [wheat, root veg]: bread, besan; *without:* potato
- Aloo bonda (batata bonda) [root veg]: potato, besan
- Mysore bonda [wheat, dairy]: maida, curd

**Suggested in its region:**
- Punugulu [rice, onion/garlic, root veg; andhra]: idli rice, urad dal; *without:* onion
- Goli baje (mangalore bajji) [wheat, dairy; karnataka]: maida, curd

### Samosa
aka singara, shingara; north, east; snack; snack; veg and non-veg; all: wheat, root veg

**Suggested:**
- Aloo samosa (punjabi samosa): maida, potato; *without:* green peas
- Onion samosa [onion/garlic; andhra]: maida, onion
- Patti samosa [onion/garlic]: maida, onion
- Keema samosa [non-veg; mutton, onion/garlic]: maida, mutton keema; *without:* onion

**Suggested in its region:**
- Shingara [peanut; bengal]: maida, potato; *without:* peanuts, cauliflower

### Vada
aka vadai, wada; south, west; snack; breakfast, snack; all: root veg

**Suggested:**
- Medu vada (uzhunnu vada, ulundu vadai) [onion/garlic]: urad dal; *without:* onion, curry leaves
- Masala vada (paruppu vadai, dal vada) [onion/garlic; suggested at snack]: chana dal; *without:* onion
- Sambar vada (sambar vadai) [onion/garlic]: urad dal, toor dal; *without:* shallots
- Batata vada (aloo vada) [onion/garlic; suggested at snack]: potato, besan; *without:* garlic
- Rava vada [wheat, onion/garlic]: sooji; *without:* onion
- Sabudana vada [peanut; maharashtra/gujarat/north; suggested at snack]: sabudana, potato; *without:* peanuts

**Suggested in its region:**
- Maddur vada [wheat, onion/garlic, rice; karnataka; suggested at snack]: sooji, rice flour, onion

### Chaat
aka chat; north, west, east; snack; snack

**Suggested:**
- Bhel puri (bhel) [rice, onion/garlic, sugar, root veg]: puffed rice, sev; *without:* onion, sweet chutney, potato
- Sev puri [wheat, root veg, onion/garlic, sugar]: papdi, potato; *without:* onion, sweet chutney, sev
- Pani puri (golgappa, puchka) [wheat, root veg, sugar]: puri shells, potato; *without:* chickpeas, sweet chutney
- Dahi puri [wheat, dairy, sugar, root veg]: puri shells, curd, potato; *without:* sweet chutney, sev
- Papdi chaat [wheat, dairy, sugar, root veg]: papdi, curd, potato; *without:* sweet chutney
- Raj kachori [wheat, dairy, sugar, root veg]: maida, curd, potato; *without:* sweet chutney, sev
- Aloo tikki chaat [root veg, dairy, sugar, onion/garlic]: potato, curd; *without:* sweet chutney, onion
- Dahi vada (dahi bhalla, thayir vadai) [dairy, sugar]: urad dal, curd; *without:* sweet chutney
- Ragda pattice [root veg, onion/garlic, sugar]: white peas, potato; *without:* onion, sweet chutney
- Chana chaat (kala chana chaat) [onion/garlic, root veg]: chickpeas; *without:* onion, tomato
- Masala corn (corn chaat, bhutta) [dairy]: sweet corn; *without:* butter, lemon
- Sweet potato chaat (shakarkandi chaat) [root veg]: sweet potato; *without:* lemon

**Suggested in its region:**
- Jhal muri [rice, onion/garlic, peanut, root veg; bengal]: puffed rice; *without:* onion, peanuts, mustard oil

### Sundal
aka sundal; tamil; snack; tiffin, snack; all: coconut

**Suggested:**
- Chana sundal (kondakadalai sundal): kala chana; *without:* coconut
- Peanut sundal (verkadalai sundal) [peanut]: peanuts; *without:* coconut
- Karamani sundal (lobia sundal): lobia; *without:* coconut
- Pattani sundal (peas sundal): white peas; *without:* coconut
- Pachai payaru sundal (green moong sundal): whole moong; *without:* coconut

## Sweets

### Kheer
aka payasam, payesh, payas, kheeri, pradhaman; north, south, west, east; sweet; lunch, dinner, snack; all: dairy, nuts, sugar

**Suggested:**
- Rice kheer (chawal ki kheer, paal payasam, payesh) [rice]: rice, milk, sugar; *without:* cashews, almonds, raisins
- Semiya payasam (seviyan kheer, vermicelli kheer) [wheat]: vermicelli, milk, sugar; *without:* cashews, raisins, ghee
- Sabudana kheer (javvarisi payasam): sabudana, milk, sugar; *without:* cashews
- Makhana kheer: makhana, milk, sugar; *without:* almonds
- Lauki kheer: lauki, milk, sugar; *without:* almonds
- Parippu payasam [coconut; kerala]: moong dal, coconut milk, jaggery; *without:* cashews, ghee

**Suggested in its region:**
- Phirni [rice; north]: rice, milk, sugar; *without:* almonds, pistachios
- Ada pradhaman [rice, coconut; kerala]: rice flour, coconut milk, jaggery; *without:* cashews, ghee
- Sakkarai pongal (sweet pongal, chakkara pongali) [rice; south]: rice, moong dal, jaggery, ghee; *without:* cashews

### Halwa
aka sheera, shira, kesari, kesari bath, halua; north, south, west, east; sweet; breakfast, lunch, dinner, snack; all: dairy, nuts, sugar

**Suggested:**
- Suji halwa (sooji halwa, sheera, shira) [wheat; suggested at breakfast, lunch, dinner, snack]: sooji, ghee, sugar; *without:* cashews, raisins
- Aate ka halwa (atte ka sheera) [wheat]: atta, ghee, sugar; *without:* almonds
- Gajar halwa (gajar ka halwa) [root veg]: carrot, milk, sugar, ghee; *without:* almonds, cashews
- Moong dal halwa: moong dal, ghee, sugar; *without:* almonds
- Lauki halwa (dudhi halwa): lauki, milk, sugar; *without:* ghee, almonds

**Suggested in its region:**
- Rava kesari (kesari bath, kesari) [wheat; south; suggested at breakfast, lunch, dinner, snack]: sooji, ghee, sugar; *without:* cashews
- Pineapple kesari [wheat; south; suggested at breakfast, lunch, dinner, snack]: sooji, ghee, sugar, pineapple; *without:* cashews
- Banana sheera [wheat; maharashtra; suggested at breakfast, lunch, dinner, snack]: sooji, ghee, sugar, banana; *without:* cashews, milk

### Ladoo
aka laddu, unde, naru; north, south, west, east; sweet; snack; all: sugar

**Suggested:**
- Besan ladoo [dairy, nuts]: besan, ghee, sugar; *without:* almonds, cashews
- Rava ladoo [wheat, dairy, coconut, nuts]: sooji, ghee, sugar; *without:* coconut, cashews
- Coconut ladoo (nariyal ladoo, narkel naru) [coconut, dairy]: coconut, sugar; *without:* condensed milk, ghee
- Til ladoo (til gul) [peanut]: sesame, jaggery; *without:* peanuts
- Dry fruit ladoo [nuts]: dry fruits, dates
- Atta ladoo (pinni, aate ke ladoo) [wheat, dairy, nuts]: atta, ghee, jaggery; *without:* almonds
- Gond ladoo [wheat, dairy, nuts]: atta, gond, ghee, sugar; *without:* almonds
- Ragi ladoo [dairy, nuts]: ragi flour, ghee, jaggery; *without:* cashews
- Peanut ladoo (shenga ladoo) [peanut]: peanuts, jaggery

## Words that mean different dishes by region

Read in the family's context, never by plain matching (decided 20).

- **curry** (curry, curries, kari, kura, koora): andhra: Sabzi → Vepudu; tamil, kerala, karnataka, south: Sabzi → Poriyal/Thoran; north, west, east, central, northeast, punjab, rajasthan, kashmir, gujarat, maharashtra, goa, sindhi, parsi, bengal, odisha, assam: Gravy → Curry
- **pachadi** (pachadi, pachdi): andhra, karnataka: Chutney; kerala, tamil: Raita

## Decided (owner, 25 Nov)

1. **A pinned dish stays fixed.** "Rajma every Sunday": Sunday's template holds the item Rajma, not the kind Dal; other days rotate within Dal.
2. **No item twice on one plate**, any kind: two sabzis or two rice curries on a plate are two different ones (sambar and rasam, never two sambars).
3. **Curd rice is not one-pot**: it is plated as rice and curd. Flavoured rices are one-pot, and one plate may hold two different flavoured rices.
4. **Dry sabzi and gravy sabzi stay separate kinds.**
5. **Onion and garlic are not a blocker**: a dish that usually has them can be made without, or with that person's portion kept aside (a note on the plate), except a dish that is mostly onion.

6. **Lemon and coconut sevai stay suggested** under Idiyappam.
7. **Regional styles are suggested within their region.** An item that is a regional style or preparation of a dish listed elsewhere (Chettinad or kadai chicken, macher jhol, Goan fish curry, Gujarati dal, varan, amti, cholar dal, the regional kadhis, ker sangri, haak) is marked regional and keeps its narrow cuisines. It is suggested to a family whose cuisine profile includes one of those cuisines. The profile is filled automatically from the cuisines of the catalog items the family's own dishes match, plus regions they mention, and is shown in the read-back for correction. Only shape, style or equipment variants of the same dish within the same cuisine, and staples, are never suggested.
8. **One-pot rice is three kinds**, each a whole plate: Khichdi (moong, masala, vegetable, bajra, dalia, Gujarati khichdi, Bengali khichuri, and savoury pongal as the South Indian khichdi), Biryani (veg, paneer, mushroom, chicken, mutton, egg, fish, prawn; Kolkata, Malabar and Ambur as regional) and Flavoured rice (lemon, tamarind, coconut, tomato, mango, sesame, mint, capsicum, vangi bath, bisi bele bath, pakhala). A khichdi night's template is [Khichdi] and rotates only khichdis; a biryani lunch is [Biryani]; a plate may hold two different flavoured rices.

Round 4 (owner, 25 Nov):

9. **Uttapam is a Dosa.** Onion, tomato, mixed-vegetable and rava uttapam are Dosa items; plain and podi uttapam stay recognised only.
10. **Meats and seafood have their own tags**: chicken, mutton (incl. goat and lamb), pork, beef; fish and prawn. In `parents`, the four meats are meat and fish and prawn are seafood, so "vegetarian", "no beef", "no pork" and "fish but no prawn" can each be checked.
11. **No "restaurant style" reason.** Anything commonly cooked at home is suggestable (paneer butter masala, paneer tikka masala, kadai paneer, malai kofta, dal makhani, butter chicken, chicken 65; regional ones as regional). Recognised only = shape or equipment variants of the same dish within a cuisine, and staples.
12. **One Gravy kind** holds the gravy vegetables, the paneer gravies and the kofta curries. Dry paneer dishes go to their kind: paneer bhurji to Sabzi, chilli paneer stays in Manchurian.

Round 5 (owner, 25 Nov):

13. **Mixed-meat tagging stands**: Kolkata and Ambur biryani carry both chicken and mutton.
14. **No beef items for now.** Beef is decided on the fly: a family's own beef dish is recognised and planned for them.
15. **Flavour-base variants are suggestable**: another tempering, sauce, masala, filling or topping (dal tadka, dal fry, masala khichdi, schezwan fried rice and noodles, chilli garlic noodles, pink sauce pasta, macaroni, mac and cheese, hot and sour and manchow soup, masala chaas, sambar vada, patti samosa, Mysore masala and onion dosa, and the like). Recognised only now means only the same dish in another shape or needing other equipment or its own plate (thatte, mini/button, Kanchipuram and sambar idli; set dosa; tandoori and tikka needing an oven), and staples.

Round 6 (owner, 25 Nov):

16. **Lunch and dinner kinds are coarse, with sub-kinds named the way families say them** (often regional). Each item has a `sub`; each kind lists its `subs` ({ name, aka, cuisines }). Sabzi holds Sabzi, Poriyal/Thoran, Vepudu, Torkari/Ghonto, Bhaja, Bharta/Chokha and Bharwa. Gravy holds Curry, Paneer, Kofta, Kurma, Dalna and Kerala curry. Dal holds Dal, Rajma/Chole (incl. usal), Pappu, Amti/Varan, Pithla/Zunka, Gujarati dal, Bengali dal, Dalma and Paruppu. Rice curry holds Sambar, Rasam, Kuzhambu/Pulusu, Kootu, Kadhi and Mor kuzhambu/Pulissery. Non-veg is by meat: Chicken, Mutton (incl. keema), Fish & seafood and Egg, each with Curry, Fry/Dry, Keema, Fish fry or Prawn sub-kinds. Regional styles stay regional items inside these sub-kinds. Breakfast kinds stay dish families.
17. **Templates may name a kind or a sub-kind**; rotation prefers the family's own sub-kinds. A plate's two items of one kind come from different sub-kinds where the template says so (sambar and rasam).

Round 7 (owner, 25 Nov):

18. **Meals say where a new item may be suggested, never what a family may eat.** A kind, sub-kind or item lists the meals the planner may suggest a new item of it at; a sub-kind or item can differ from its kind. A family's own dish at a meal outside its meals is a fixed part of their template (`items`: only their dishes, nothing new suggested), so "appam with stew" is [Appam, Vegetable stew] and never brings aviyal or paneer butter masala to breakfast. Gravy, Mutton, the rice curries other than sambar, the khichdis other than pongal, egg curries, chicken and fish curries are lunch and dinner only; sambar, pongal, misal and the breakfast halwas (suji halwa, rava and pineapple kesari, banana sheera) keep breakfast. Khichdi has sub-kinds Khichdi and Pongal; Pav meal has Misal, Pav bhaji and Vada pav.
19. **The family's words win over the catalog's meals.** A part the family names as a category ("some khichdi", "any dal", "a different khichdi each time") is that kind or sub-kind, and new items of it are suggested at that meal even where the catalog does not list the meal. A part they name as a dish ("khichdi", "boiled chicken", "vegetable stew") at a meal outside the catalog's meals is that fixed dish. The catalog's meals decide only the parts the family left general. A dish with no kind in the catalog goes under a nearby kind only when it plays the same part on the plate; otherwise it is a kind of the family's own (`own`), its template holding just their dish, and nothing new is suggested for it.

Round 8 (owner, 26 Nov):

20. **Regional words are read in context.** Some words mean different dishes by region: "curry" (kari, kura) is a dry vegetable dish in South Indian homes (a Vepudu in Andhra and Telangana, a Poriyal/Thoran in Tamil Nadu, Kerala and Karnataka) and a gravy elsewhere; "pachadi" is a chutney in Andhra, Telangana and Karnataka and a curd dish (raita-like) in Kerala and Tamil Nadu. These words are in no kind's or item's other names (`regional` in the catalog lists each word's meanings by cuisine). Setup settles one in code only when the family's region is clear from their other words (their other dishes' narrow cuisines, a state or region they name); otherwise the kinds read decides from the family's whole answer. A dish named with one ("dondakaya curry", "tomato pachadi") goes where its vegetable and the word's meaning put it (a dish of another kind, a paneer or chicken curry, is not moved), and the family's own word is kept in the read-back.

Round 9 (owner, 26 Nov):

21. **Dishes are checked by their ingredients, main or leave-out-able.** Every catalog item lists its ingredients as usually made in an Indian home (`scripts/kinds/ingredients.js`); its content tags are derived from them, never written by hand. Each ingredient is **main** (the dish is not itself without it: mooli in mooli thepla, onion in kanda poha, paneer in paneer bhurji) or **leave-out-able** (a garnish, tempering or add-in the dish is still itself without: cashews in suji upma, onion and peanuts in vegetable poha, ghee on top, coriander). For each person at the table and each of their hard rules or allergies: a main ingredient that breaks it means the dish is not theirs (another item, or their own item, as before); only leave-out-able ones mean the dish is fine for them, with a note "make without <ingredients> for <person>" ("make without peanuts" when the whole house keeps the rule; onion and garlic keep rule 5's "make without onion and garlic, or keep <person>'s portion aside"). This holds for the family's own dishes and for catalog-picked ones, including items picked for a category the family named: those count as theirs for variety but are always checked for allergies (the family's own named dishes stay vouched for their allergies). A dish the catalog does not know keeps its read: every tag it has counts as main. Every planned catalog item is read for every catalog tag (none left unknown to fail closed on). Onion, garlic and ginger count as root vegetables, as in the planner's own categories.

Round 10 (owner, 26 Nov):

22. **Urad dal removed**: not an everyday dal for most homes (owner 26 Nov).

## Open questions

Grain choices still open. Points already decided are in the section above.

1. **Sub-kinds and kinds to check**: Pork stays its own kind (6 items: pork curry plus Goan, Coorg and Naga styles), not under Mutton, so a "no pork" household is easy to read. Eggs (breakfast) and Egg curry are one Egg kind with two sub-kinds. Some sub-kinds have one item (Gujarati dal, Dalma, Kurma, Chicken keema) and Amti/Varan, Pithla/Zunka and Vepudu have two: keep them as sub-kinds so a family's own word maps to them, or fold into the plain sub-kind? Sundal, Pav meal, Kozhukattai, Curd (1 item) and Mudde (2) stay kinds. Palya and upkari are names under Poriyal/Thoran (no Karnataka-only items yet). Eromba (Manipuri fish mash) sits under Bharta/Chokha, so Sabzi is a mixed-diet kind.
2. **Regional or not**: some calls were close. Dal makhani, phirni and kadai chicken are marked regional (north); Mysore masala dosa, kara kuzhambu and Puneri and Kolhapuri misal are suggested to everyone (flavour-base variants), not marked regional. Items already narrow and suggested on their own (pesarattu, gatte, mochar ghonto, sabudana khichdi) are not marked regional, but their cuisines narrow them the same way. Should they be marked regional too?
3. **Prawn curry and prawn fry are both suggested**, as different dishes of one kind. Chicken fry and fish fry, by contrast, are their own kinds.
4. **Contents err towards safety**: parathas and theplas carry dairy (ghee or curd); rava upma carries both cashew and peanut.
5. **Kanchipuram idli** is kept recognised only as the same batter as idli with spices added. If the owner counts its pepper-cumin-ghee seasoning as a flavour base, it becomes suggestable (tamil, regional). Same question for **sambar idli** (kept back because it needs a sambar plate).
6. **Left out**: dal-baati-churma, dal dhokli, parotta, naan/kulcha, store sweets (gulab jamun, rasgulla), mishti doi, shrikhand. Curd rice was removed (rice + curd).
7. **Grain tags**: rava, maida, sooji, pav and bread are tagged wheat; poha, puffed rice and rice flour are tagged rice; ragi, jowar, bajra and millets are untagged. Brown and matta rice are not tagged rice.
