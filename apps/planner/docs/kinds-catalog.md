# Meal Planner: dish kinds catalog

This is the review copy of `server/kinds.json`. Please read it as a cook would and mark anything wrong.

**A kind** is a dish family a household names when it says what is on the plate: Idli, Dosa, Poha, Roti, Dal, Sabzi, Rice, Curd. Each meal is a template of kinds: breakfast [Dosa], lunch [Rice, Dal, Sabzi, Curd], dinner [Roti, Sabzi]. A kind is never a vague slot like "breakfast dish" or "main".

**An item** is one variant of a kind: Dosa has plain dosa, masala dosa, rava dosa, set dosa; Sabzi has bhindi, aloo gobi, lauki, tinda, beans poriyal.

**How it is used.**
- *Setup*: the family's own words ("aloo sabzi", "poriyal", "pappu", "kande pohe") are matched to a kind through the kind's and items' other names (aka), so the family's plates become templates of kinds.
- *Planning*: for variety the planner picks a NEW item of the same kind for the slot (another dry vegetable for a dry vegetable), and repeats an item only when all fitting items have been used. It prefers items of the family's cuisines; an item's own cuisines narrow it further.
- *Food rules and allergies*: each item lists what it contains **as usually made in an Indian home** (contents below in brackets). Where a common version has something (peanuts in Maharashtrian poha, cashews in rava upma, garlic in tomato rasam) it is listed, so a rule is never broken by a guess. A family's own recipe can still say otherwise.

**Reading the headings**: Kind, its other names, its cuisines, its place on the plate (staple, main, side, complete = a whole plate alone, sweet, snack, drink), and the meals it appears at. Contents shared by every item of the kind are said once on the heading line ("all: rice"); each item's brackets show the rest. A diet is shown on an item only in kinds that mix veg and non-veg.

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

**Suggested:** Idli (idly) [rice], Rava idli (sooji idli) [wheat, dairy, nuts], Ghee podi idli (podi idli) [rice, dairy], Ragi idli [rice], Oats idli [wheat, dairy]

**Recognised only:** Kanchipuram idli (kanchipuram kudalai idli) [rice, dairy, nuts; tamil], Mini idli (button idli, cocktail idli) [rice], Thatte idli [rice; karnataka], Sambar idli (sambar dip idli) [rice, onion/garlic]

### Dosa
aka dosai, dose, dosey, pesarattu, pesara dosa, moong dal dosa, green gram dosa, adai, adai dosai, adai dosa, uttapam, uthappam, oothappam, uttappa; south; complete; breakfast, dinner, tiffin; veg and non-veg

**Suggested:** Plain dosa (sada dosa, dosai) [rice], Masala dosa [rice, root veg, onion/garlic], Mysore masala dosa [rice, root veg, onion/garlic; karnataka], Ghee roast dosa (ghee roast, nei roast) [rice, dairy], Benne dosa (butter dosa, davangere benne dose) [rice, dairy; karnataka], Onion dosa (vengaya dosai) [rice, onion/garlic], Rava dosa (rava dosai) [rice, wheat, onion/garlic], Ragi dosa [rice], Wheat dosa (godhuma dosa, atta dosa) [wheat, onion/garlic], Egg dosa (muttai dosai) [egg; rice, egg], Pesarattu (pesara dosa) [rice, onion/garlic; andhra], Upma pesarattu (MLA pesarattu) [rice, onion/garlic, wheat; andhra], Adai (adai dosai) [rice, onion/garlic; tamil/kerala], Vegetable adai [rice, onion/garlic, root veg; tamil/kerala], Murungai keerai adai (drumstick leaf adai) [rice, onion/garlic; tamil/kerala], Onion uttapam (vengaya uthappam) [rice, onion/garlic], Tomato uttapam [rice, onion/garlic], Mixed vegetable uttapam (veg uttapam) [rice, onion/garlic, root veg], Rava uttapam (sooji uttapam) [wheat, dairy, onion/garlic], Podi uttapam [rice]

**Suggested in its region:** Neer dosa [rice, coconut; karnataka]

**Recognised only:** Set dosa (sponge dosa) [rice; karnataka], Kal dosai (kal dosa) [rice; tamil], Plain uttapam [rice]

### Upma
aka uppittu, uppumavu, kharabath, upeet, uppuma, khara bath; north, south, west; complete; breakfast, dinner, tiffin

**Suggested:** Rava upma (sooji upma, uppittu, upeet) [wheat, onion/garlic, nuts, peanut], Vegetable upma (khara bath) [wheat, onion/garlic, root veg, nuts], Semiya upma (vermicelli upma, shevai upma) [wheat, onion/garlic, nuts], Dalia upma (broken wheat upma, godhuma rava upma, vegetable dalia, namkeen dalia, masala dalia) [wheat, onion/garlic], Rice upma (arisi upma, akki tari uppittu) [rice, onion/garlic, coconut], Bread upma [wheat, onion/garlic], Oats upma (masala oats) [onion/garlic, root veg], Idli upma (leftover idli upma) [rice, onion/garlic], Sabudana khichdi (sabudana upma, javvarisi upma, sago upma) [peanut, root veg; maharashtra/gujarat/north]

### Poha
aka pohe, aval, avalakki, chira, chire, chuda, atukulu, avil, flattened rice; north, west, south, east, central; complete; breakfast, tiffin, snack; all: rice

**Suggested:** Kanda poha (kande pohe, onion poha) [onion/garlic, peanut; maharashtra], Batata poha (batata pohe, aloo poha) [onion/garlic, peanut, root veg; west], Matar poha (peas poha) [onion/garlic, peanut], Vegetable poha [onion/garlic, peanut, root veg]

**Suggested in its region:** Indori poha [onion/garlic, peanut, sugar; central], Dadpe pohe [onion/garlic, coconut; maharashtra], Aval upma (poha upma, aval kichadi) [onion/garlic, peanut; tamil], Avalakki oggarane (avalakki) [onion/garlic, peanut; karnataka], Aval nanachathu [coconut, sugar; kerala], Chire bhaja (chira bhaja) [onion/garlic, peanut; bengal], Doi chire (dahi chura) [dairy, sugar; east]

### Paratha
aka parantha, parotha, prantha, porota; north, punjab, west; complete; breakfast, lunch, dinner, tiffin; veg and non-veg; all: dairy, wheat

**Suggested:** Aloo paratha [root veg], Gobi paratha, Methi paratha, Paneer paratha, Mooli paratha, Palak paratha, Pyaaz paratha (onion paratha) [onion/garlic], Mixed vegetable paratha (veg paratha) [root veg], Dal paratha, Matar paratha (peas paratha), Sattu paratha [onion/garlic; east], Egg paratha (anda paratha) [egg; egg], Keema paratha [non-veg; mutton, onion/garlic]

**Suggested in its region:** Sindhi koki (koki) [onion/garlic; sindhi]

**Recognised only:** Lachha paratha (plain paratha, tikona paratha)

### Thepla
aka theplu, methi na thepla; gujarat; complete; breakfast, tiffin, dinner, snack; all: dairy, wheat

**Suggested:** Methi thepla (methi na thepla), Plain thepla (masala thepla), Dudhi thepla (lauki thepla), Palak thepla, Bajra methi thepla, Mooli thepla

### Thalipeeth
aka thalipith, thalipeet; maharashtra; complete; breakfast, snack

**Suggested:** Bhajani thalipeeth [wheat, rice, onion/garlic], Jowar thalipeeth [onion/garlic], Methi thalipeeth [wheat, rice, onion/garlic], Kakdi thalipeeth (cucumber thalipeeth) [rice, onion/garlic], Sabudana thalipeeth (upvas thalipeeth) [peanut, root veg]

### Chilla
aka cheela, chila, pudla, puda, poodla; north, west, central; complete; breakfast, tiffin, dinner; all: onion/garlic

**Suggested:** Besan chilla (besan cheela, pudla), Moong dal chilla (moong dal cheela), Paneer chilla (stuffed paneer chilla) [dairy], Rava chilla (sooji chilla) [wheat, dairy], Oats chilla, Vegetable chilla [root veg]

### Appam
aka aappam, hoppers, palappam, vellayappam; kerala, tamil; main; breakfast, dinner; all: sugar, coconut

**Suggested:** Appam (palappam, vellayappam) [rice], Kallappam [rice], Rava appam (instant appam) [wheat]

### Puttu
aka pittu, puttu kadala; kerala; main; breakfast, dinner; all: coconut

**Suggested:** Rice puttu (puttu, arisi puttu) [rice], Wheat puttu (gothambu puttu) [wheat], Ragi puttu, Corn puttu (cholam puttu, maize puttu)

### Idiyappam
aka string hoppers, nool puttu, sevai, noolappam, shavige, ottu shavige; kerala, tamil, karnataka; main; breakfast, dinner, tiffin

**Suggested:** Idiyappam (rice idiyappam, string hoppers, nool puttu, noolappam) [rice], Ragi idiyappam (ragi shavige) [rice], Wheat idiyappam (gothambu idiyappam) [wheat], Lemon sevai (elumichai sevai, lemon shavige) [rice, peanut], Coconut sevai (thengai sevai) [rice, coconut]

### Kozhukattai
aka kolukattai, modak, kadubu, undrallu; south, maharashtra; snack; breakfast, snack; all: rice, coconut

**Suggested:** Pidi kozhukattai, Ulundu kozhukattai (uppu kozhukattai), Sweet kozhukattai (modak, ukadiche modak, modakam, kadubu) [sugar, dairy]

**Recognised only:** Ammini kozhukattai

### Akki roti
aka akki rotti, rotti, rice roti; karnataka; complete; breakfast, dinner

**Suggested:** Akki roti (akki rotti) [rice, onion/garlic, coconut], Ragi roti (ragi rotti) [onion/garlic], Sabsige akki roti (dill akki roti) [rice, onion/garlic, coconut]

**Suggested in its region:** Pathiri (ari pathiri) [rice; kerala]

### Paniyaram
aka kuzhi paniyaram, paddu, gunta ponganalu, appe, guliyappa; south, maharashtra; complete; breakfast, snack, tiffin

**Suggested:** Kara paniyaram (kuzhi paniyaram, paddu, gunta ponganalu) [rice, onion/garlic], Sweet paniyaram (inippu paniyaram) [rice, sugar], Rava appe [wheat, dairy, onion/garlic], Ragi paniyaram [rice, onion/garlic]

### Puri
aka poori, luchi, bhatura, pakwan; north, west, east, south; staple; breakfast, lunch, dinner, tiffin; all: wheat

**Recognised only:** Puri (poori), Masala puri (ajwain puri), Palak puri, Luchi [bengal], Radhaballabhi [bengal], Bedmi puri [north], Bhatura (bhature) [dairy], Pakwan [sindhi], Mangalore buns (banana puri) [sugar, dairy; karnataka]

### Kachori
aka kochuri, kachauri; north, rajasthan, east; snack; breakfast, snack; all: wheat

**Suggested:** Khasta kachori (dal kachori), Pyaaz kachori (onion kachori) [onion/garlic; rajasthan], Matar kachori (koraishutir kochuri), Aloo kachori [root veg]

**Suggested in its region:** Hing kochuri [bengal]

### Porridge
aka oats, oatmeal, dalia, daliya, ragi malt, kanji; north, west, south, continental; complete; breakfast; all: dairy, sugar

**Suggested:** Oats porridge (oatmeal) [continental], Overnight oats [nuts; continental], Sweet milk dalia (meetha dalia, dalia porridge) [wheat, nuts; north/west], Ragi malt (ragi porridge, ragi java, ragi kanji) [south]

**Suggested in its region:** Lapsi (fada ni lapsi) [wheat, nuts; gujarat]

### Cereal
aka cornflakes, muesli, chocos; continental; complete; breakfast; all: dairy, sugar

**Suggested:** Cornflakes with milk (cornflakes), Muesli [nuts, wheat], Chocos [wheat], Wheat flakes [wheat]

### Toast
aka bread toast, bread butter; continental; complete; breakfast, tiffin, snack; veg and non-veg; all: wheat

**Suggested:** Bread butter toast (butter toast) [dairy], Bread jam (jam toast) [sugar], French toast [egg; egg, dairy, sugar], Masala toast [dairy, onion/garlic, root veg], Peanut butter toast [peanut, sugar], Cheese toast (chilli cheese toast) [dairy]

### Sandwich
aka sandwiches; continental, west; complete; breakfast, tiffin, snack; veg and non-veg; all: dairy, wheat

**Suggested:** Vegetable sandwich (veg sandwich), Grilled cheese sandwich (cheese sandwich), Paneer sandwich, Aloo sandwich (potato sandwich) [root veg], Corn sandwich (corn cheese sandwich), Chutney sandwich, Egg sandwich (egg mayo sandwich) [egg; egg], Chicken sandwich [non-veg; chicken, egg]

**Suggested in its region:** Bombay sandwich [root veg; maharashtra]

### Eggs
aka anda, muttai, egg; north, south, west, east; main; breakfast, dinner, tiffin; egg; all: egg

**Suggested:** Masala omelette (omelette, anda omelette) [onion/garlic], Plain omelette, Egg bhurji (anda bhurji) [onion/garlic], Boiled eggs, Half fry (fried egg, bull's eye), Bread omelette [wheat, onion/garlic]

**Suggested in its region:** Akuri [onion/garlic, dairy; parsi], Egg podimas (muttai podimas) [onion/garlic; tamil], Scrambled eggs [dairy; continental]

### Dhokla
aka khaman, farsan, muthia, muthiya, handvo, handwa; gujarat; snack; breakfast, snack, tiffin

**Suggested:** Khaman dhokla (khaman) [sugar], Khatta dhokla (idada) [rice, dairy], Rava dhokla (sooji dhokla) [wheat, dairy], Moong dal dhokla, Khandvi [dairy, coconut], Methi muthia (muthia, muthiya) [wheat, dairy, sugar], Dudhi muthia (lauki muthia) [wheat, dairy, sugar], Handvo (mixed dal handvo) [rice, dairy, sugar], Rava handvo (sooji handvo) [wheat, dairy], Vegetable handvo [rice, dairy, root veg, sugar]

**Recognised only:** Sandwich dhokla [rice, dairy]

### Pav meal
aka pav bhaji, bhaji pav, misal, misal pav, usal pav, vada pav, dabeli, pav; maharashtra, gujarat; complete; breakfast, dinner, snack; all: wheat

**Suggested:** Misal pav [onion/garlic], Puneri misal [onion/garlic, rice, sugar], Kolhapuri misal [onion/garlic, coconut], Usal pav [onion/garlic], Pav bhaji [dairy, root veg, onion/garlic], Jain pav bhaji [dairy], Masala pav [dairy, onion/garlic], Dabeli (kutchi dabeli) [root veg, peanut, sugar; gujarat], Vada pav [root veg, onion/garlic; maharashtra]

### Pitha
aka pithe, pitta; east, bengal, odisha, assam; snack; breakfast, snack; all: rice

**Suggested:** Patishapta [wheat, coconut, sugar, dairy; bengal], Chitoi pitha (chitol pitha) [bengal], Til pitha [sugar; assam], Chakuli pitha [odisha]

**Recognised only:** Puli pitha [coconut, sugar; bengal], Bhapa pitha [coconut, sugar], Enduri pitha [coconut, sugar; odisha], Poda pitha [coconut, sugar; odisha]

## Lunch and dinner: staples

These come every day their plate has them (staple: yes). The planner does not rotate them for variety.

### Roti
aka chapati, phulka, fulka, rotli, poli, chapathi, chapatti; north, south, west, east, central; staple (every day its plate has it); lunch, dinner, tiffin

**Recognised only:** Phulka (fulka) [wheat], Chapati (chapathi, rotli, poli, tawa roti) [wheat], Ghee roti (ghee chapati, tup poli) [wheat, dairy], Missi roti [wheat, onion/garlic], Makki ki roti (makki di roti, makai roti) [punjab], Multigrain roti (multigrain chapati) [wheat]

### Bhakri
aka bhakar, rotla, rotlo, jolada rotti, jowar roti, bajra roti, millet roti; maharashtra, gujarat, rajasthan, karnataka; staple (every day its plate has it); lunch, dinner

**Recognised only:** Jowar bhakri (jowar roti, jolada rotti), Bajra bhakri (bajra roti, bajra no rotlo, bajre ki roti), Nachni bhakri (ragi bhakri, ragi roti (flat)), Rice bhakri (tandlachi bhakri, akki bhakri) [rice; maharashtra/goa], Wheat bhakri (ghau ni bhakri) [wheat; gujarat]

### Rice
aka chawal, bhaat, bhat, sadam, annam, anna, plain rice; north, south, west, east; staple (every day its plate has it); lunch, dinner

**Recognised only:** Steamed rice (plain rice, chawal, bhaat, sadam, annam) [rice], Jeera rice [rice, dairy], Brown rice, Matta rice (kerala red rice, rosematta, red rice) [kerala]

### Curd
aka dahi, thayir, mosaru, perugu, doi, yogurt; north, south, west, east; side (every day its plate has it); lunch, dinner

**Recognised only:** Curd (dahi, thayir, mosaru, perugu, doi) [dairy]

### Mudde
aka ragi mudde, ragi sangati, ragi ball, sankati; karnataka, andhra; staple (every day its plate has it); lunch, dinner

**Recognised only:** Ragi mudde (ragi ball, ragi kali), Ragi sangati (sankati) [rice; andhra]

## Lunch and dinner: dals and rice curries

Dal covers every lentil and legume dal, rajma and chole included. Rice curry covers the curries eaten with rice: sambar, rasam, kuzhambu, kootu, kadhi.

### Dal
aka daal, pappu, paruppu, amti, varan, dali, dalma, tovve, bele, parippu, lentils, rajma, chole, chhole, chana, usal, lobia, ghugni, kadala curry, kabuli chana, rassa, pithla, pitla, zunka, jhunka; north, south, west, east, central; main; lunch, dinner

**Suggested:** Moong dal (yellow moong dal, dhuli moong) [onion/garlic], Masoor dal (red lentil dal) [onion/garlic], Toor dal (arhar dal, tuvar dal) [onion/garlic], Chana dal (chane ki dal) [onion/garlic], Urad dal (dhuli urad dal) [onion/garlic], Mixed dal (panchratna dal) [onion/garlic], Dal tadka (yellow dal tadka) [dairy, onion/garlic], Dal fry [onion/garlic], Palak dal (dal palak) [onion/garlic], Lauki chana dal [onion/garlic], Tomato pappu [onion/garlic; andhra], Mamidikaya pappu (mango dal) [onion/garlic; andhra], Dosakaya pappu [onion/garlic; andhra], Rajma (rajma masala, rajma chawal) [onion/garlic], Chole (chana masala, chhole, kabuli chana) [onion/garlic], Kala chana curry (kale chane) [onion/garlic], Lobia (lobia masala, chawli) [onion/garlic], Safed matar (ragda, white peas curry) [onion/garlic], Matki usal [onion/garlic, coconut; maharashtra], Moong usal [onion/garlic, coconut; maharashtra], Sprouts curry (moong sprouts curry) [onion/garlic], Pithla (pitla) [onion/garlic; maharashtra], Zunka (jhunka) [onion/garlic; maharashtra]

**Suggested in its region:** Panchmel dal [dairy, onion/garlic; rajasthan], Dal makhani [dairy, onion/garlic; punjab], Khatti dal [onion/garlic; andhra], Gujarati dal (gujarati toor dal, khatti meethi dal) [sugar, peanut; gujarat], Varan (varan bhaat dal) [maharashtra], Amti (katachi amti, toor dal amti) [sugar, coconut; maharashtra], Muddha pappu (plain pappu) [andhra], Palakura pappu (spinach pappu) [onion/garlic; andhra], Paruppu (paruppu kadayal) [tamil], Kerala parippu curry (parippu) [coconut; kerala], Tovve [karnataka], Cholar dal [coconut, sugar, dairy; bengal], Bengali masoor dal (musur dal) [onion/garlic; bengal], Sona moong dal (bhaja moong dal) [dairy; bengal], Dalma [root veg, brinjal, coconut; odisha], Sai bhaji (sindhi sai bhaji) [onion/garlic, root veg, brinjal; sindhi], Jammu rajma (chitra rajma) [onion/garlic; kashmir], Pindi chole [onion/garlic; punjab], Ghugni [onion/garlic; east], Vatana usal [onion/garlic, coconut; maharashtra], Kadala curry [onion/garlic, coconut; kerala], Chana ghassi [coconut; karnataka]

### Rice curry
aka sambar, sambhar, rasam, kuzhambu, kulambu, kootu, kadhi, kadi, saaru, charu, pulusu, mor kuzhambu, majjige huli, pulissery, huli, gojju; south, north, west, sindhi; main; breakfast, lunch, dinner

**Suggested:** Drumstick sambar (murungakkai sambar) [onion/garlic; south], Mixed vegetable sambar [onion/garlic, root veg; south], Onion sambar (vengaya sambar, small onion sambar) [onion/garlic; south], Radish sambar (mullangi sambar) [onion/garlic, root veg; south], Brinjal sambar (kathirikai sambar) [onion/garlic, brinjal; south], Pumpkin sambar (parangikai sambar) [onion/garlic; south], Okra sambar (vendakkai sambar) [onion/garlic; south], Tiffin sambar (idli sambar) [onion/garlic; south], Tomato rasam (thakkali rasam, tomato charu) [onion/garlic; south], Pepper rasam (milagu rasam) [onion/garlic; south], Lemon rasam (elumichai rasam) [south], Garlic rasam (poondu rasam) [onion/garlic; south], Paruppu rasam (dal rasam) [south], Pineapple rasam [sugar; south], Jeera rasam (jeeragam rasam) [south], Kollu rasam (horsegram rasam) [onion/garlic; south], Vatha kuzhambu (vathal kuzhambu) [onion/garlic; tamil], Kara kuzhambu [onion/garlic; tamil], Poondu kuzhambu (garlic kuzhambu) [onion/garlic; tamil], Ennai kathirikai kuzhambu [brinjal, onion/garlic; tamil], Paruppu urundai kuzhambu [onion/garlic; tamil], Puli kuzhambu (tamarind kuzhambu) [onion/garlic; tamil], Sorakaya pulusu [onion/garlic; andhra], Bendakaya pulusu (okra pulusu) [onion/garlic; andhra], Pineapple gojju [sugar; karnataka], Hagalakai gojju (bitter gourd gojju) [karela, sugar; karnataka], Chow chow kootu [coconut; tamil/kerala], Poricha kootu [coconut; tamil/kerala], Keerai kootu (spinach kootu) [coconut; tamil/kerala], Pudalangai kootu (snake gourd kootu) [coconut; tamil/kerala], Kathirikai kootu (brinjal kootu) [coconut, brinjal; tamil/kerala], Cabbage kootu [coconut; tamil/kerala], Punjabi kadhi pakora (kadhi pakoda) [dairy, onion/garlic; punjab], Gujarati kadhi [dairy, sugar; gujarat], Sindhi kadhi [root veg; sindhi], Mor kuzhambu [dairy, coconut; tamil]

**Suggested in its region:** Arachuvitta sambar [coconut; tamil], Udupi sambar (huli) [coconut, sugar; karnataka], Kerala sambar [coconut, onion/garlic; kerala], Mysore rasam [coconut; karnataka], Udupi saaru (udupi rasam) [sugar; karnataka], Mukkala pulusu [onion/garlic, root veg, brinjal; andhra], Rajasthani kadhi [dairy; rajasthan], Maharashtrian kadhi (taak kadhi) [dairy; maharashtra], Majjige huli [dairy, coconut; karnataka], Pulissery (moru curry) [dairy, coconut; kerala]

## Lunch and dinner: vegetables

### Sabzi
aka sabji, subzi, sukhi sabzi, dry sabzi, bhaji, poriyal, porial, thoran, torkari, palya, vepudu, upkari, shaak, fugath, sukke; north, south, west, east, central; main; lunch, dinner, tiffin

**Suggested:** Bhindi sabzi (bhindi fry, bhindi masala, vendakkai poriyal) [onion/garlic], Aloo gobi [root veg, onion/garlic], Jeera aloo (aloo jeera) [root veg], Aloo methi [root veg, onion/garlic], Aloo bhaji (puri bhaji, batata bhaji, batatyachi bhaji) [root veg], Lauki sabzi (doodhi sabzi, ghiya), Tinda sabzi [onion/garlic], Turai sabzi (tori, ridge gourd sabzi) [onion/garlic], Parwal sabzi (potol) [onion/garlic], Karela sabzi (karela fry) [karela, onion/garlic], Cabbage sabzi (patta gobhi) [onion/garlic], Beans sabzi (french beans sabzi), Gajar matar [root veg], Kaddu sabzi (khatta meetha kaddu, pumpkin sabzi) [sugar], Arbi sabzi (arbi fry, colocasia) [root veg], Baingan aloo (aloo baingan) [brinjal, root veg, onion/garlic], Aloo shimla mirch (capsicum aloo) [root veg], Kundru sabzi (tondli, tindora, tindora nu shaak) [onion/garlic], Mixed vegetable sabzi (mix veg sukhi) [root veg, onion/garlic], Suran sabzi (yam sabzi) [root veg], Methi bhaji (methichi bhaji) [onion/garlic; maharashtra], Carrot poriyal [root veg, coconut; south], Beetroot poriyal (beetroot thoran) [root veg, coconut; south], Vazhakkai poriyal (raw banana fry, kachche kele ki sabzi) [south], Keerai poriyal (spinach poriyal, cheera thoran) [coconut; south], Mochar ghonto [root veg, coconut; bengal], Paneer bhurji [dairy, onion/garlic]

**Suggested in its region:** Ker sangri [rajasthan], Haak (haak saag) [kashmir], Bateta nu shaak [root veg, sugar; gujarat], Beans poriyal (beans thoran, beans palya) [coconut; south], Cabbage thoran (cabbage poriyal) [coconut; south], Urulaikizhangu roast (potato roast, aloo fry) [root veg; south], Senai roast (yam fry, suran fry) [root veg; south], Kovakkai fry [onion/garlic; south], Bendakaya vepudu [onion/garlic; andhra], Dondakaya vepudu [onion/garlic, peanut; andhra], Shukto [karela, brinjal, root veg, dairy, sugar; bengal], Chorchori [root veg, brinjal; bengal], Lau ghonto [dairy; bengal], Aloo posto [root veg; bengal], Bandhakopir torkari [root veg; bengal]

### Gravy
aka gravy sabzi, rasedar sabzi, curry, tari wali sabzi, masala, korma, kurma, kofta, kofta curry, salan, rassa, dalna, shaak, paneer, paneer sabzi; north, south, west, east; main; lunch, dinner

**Suggested:** Aloo matar [root veg, onion/garlic], Aloo tamatar (aloo rasedar) [root veg], Aloo palak (palak aloo) [root veg, onion/garlic], Dum aloo [root veg, dairy, onion/garlic], Matar mushroom [mushroom, onion/garlic], Mushroom masala [mushroom, onion/garlic], Mix veg curry (mixed vegetable curry) [root veg, onion/garlic], Baingan masala [brinjal, onion/garlic], Methi matar malai [dairy, nuts, onion/garlic], Kathal sabzi (jackfruit curry, echorer dalna) [onion/garlic, root veg], Soya chunks curry (soya curry) [soy, onion/garlic], Sarson da saag (sarson ka saag) [dairy, onion/garlic; punjab], Gatte ki sabzi [dairy, onion/garlic; rajasthan], Papad ki sabzi [dairy; rajasthan], Nadru yakhni [dairy; kashmir], Palak paneer (saag paneer) [dairy, onion/garlic], Matar paneer [dairy, onion/garlic], Paneer butter masala [dairy, nuts, sugar, onion/garlic], Kadai paneer [dairy, onion/garlic], Shahi paneer [dairy, nuts, onion/garlic], Paneer tikka masala [dairy, onion/garlic], Paneer do pyaza [dairy, onion/garlic], Achari paneer [dairy, onion/garlic], Lauki kofta [onion/garlic], Malai kofta [dairy, nuts, root veg, onion/garlic], Paneer kofta [dairy, onion/garlic], Palak kofta [onion/garlic], Raw banana kofta (kachche kele ke kofte) [onion/garlic]

**Suggested in its region:** Kashmiri dum aloo [root veg, dairy; kashmir], Vegetable kurma (veg korma) [root veg, coconut, nuts, onion/garlic; south], Sev tameta (sev tameta nu shaak) [onion/garlic, sugar; gujarat], Undhiyu [root veg, brinjal, coconut, peanut, sugar, wheat; gujarat], Aloo dalna [root veg, dairy, sugar; bengal], Potol dalna [root veg, dairy, sugar; bengal], Santula [root veg, brinjal; odisha], Papaya khar (khar) [assam], Khatkhate [coconut, root veg; goa]

### Stuffed vegetable
aka bharwa, bharli, gutti, bharela, bharva; north, west, andhra; main; lunch, dinner

**Suggested:** Bharwa bhindi (stuffed bhindi) [onion/garlic], Bharwa baingan (stuffed baingan) [brinjal, onion/garlic], Bharwa karela (stuffed karela) [karela, onion/garlic], Bharwa tinda [onion/garlic], Bharwa parwal [onion/garlic], Stuffed capsicum (bharwa shimla mirch) [root veg, onion/garlic]

**Suggested in its region:** Gutti vankaya [brinjal, onion/garlic, peanut; andhra], Bharli vangi [brinjal, onion/garlic, peanut, coconut; maharashtra], Bharela ringan bateta [brinjal, root veg, peanut, sugar; gujarat]

### Kerala curry
aka avial, aviyal, olan, erissery, kalan, theeyal, stew, ishtu, kappa; kerala; main; breakfast, lunch, dinner; all: coconut

**Suggested:** Aviyal (avial) [dairy, root veg], Olan, Erissery, Kalan [dairy, root veg], Kootu curry [root veg], Vegetable stew (ishtu) [root veg, onion/garlic], Ulli theeyal (theeyal) [onion/garlic], Pavakka theeyal [karela, onion/garlic], Kappa puzhukku (kappa, tapioca mash) [root veg]

### Bhaja
aka bhaji (bengali fry); bengal, odisha; side; lunch, dinner

**Suggested:** Begun bhaja [brinjal], Alu bhaja (jhuri alu bhaja) [root veg], Potol bhaja, Uchhe bhaja (korola bhaja) [karela], Kumro bhaja (pumpkin bhaja), Beguni [brinjal]

### Bharta
aka chokha, pitika, bhorta, bharit, pora; north, east, bengal, assam, maharashtra, northeast; side; lunch, dinner; veg and non-veg

**Suggested:** Baingan bharta [brinjal, onion/garlic], Aloo chokha [root veg, onion/garlic; east], Tomato chokha [onion/garlic; east]

**Suggested in its region:** Baingan chokha [brinjal, onion/garlic; east], Aloo pitika [root veg, onion/garlic; assam], Begun pora [brinjal, onion/garlic; bengal], Vangyache bharit (baingan bharit) [brinjal, onion/garlic, peanut; maharashtra], Eromba [non-veg; fish; northeast]

## Lunch and dinner: rice dishes

Khichdi, Biryani and Flavoured rice are each a whole plate on their own (with papad, raita or pickle at most); a khichdi night rotates only khichdis, a biryani lunch only biryanis, and a plate may hold two different flavoured rices. Pulao is not a whole plate: it stands where plain rice stands and needs a dal or curry beside it.

### Pulao
aka pulav, pilaf, ghee rice, neychoru; north, south, west, east, kashmir; main; lunch, dinner, tiffin; veg and non-veg; all: rice

**Suggested:** Vegetable pulao (veg pulao) [dairy, onion/garlic, root veg], Matar pulao (peas pulao) [dairy, onion/garlic], Paneer pulao [dairy, onion/garlic], Chana pulao [onion/garlic], Yakhni pulao (mutton yakhni pulao) [non-veg; mutton, dairy, onion/garlic], Chicken pulao [non-veg; chicken, dairy, onion/garlic]

**Suggested in its region:** Kashmiri pulao [dairy, nuts, sugar; kashmir], Ghee rice (neychoru) [dairy, nuts, onion/garlic; kerala], Coconut milk pulao (thengai paal sadam) [coconut, onion/garlic; tamil], Basanti pulao (mishti pulao) [dairy, nuts, sugar; bengal], Tawa pulao [dairy, root veg, onion/garlic; maharashtra]

### Biryani
aka biriyani, dum biryani; north, south, west, east; complete; lunch, dinner; veg and non-veg; all: onion/garlic, rice

**Suggested:** Veg biryani (vegetable biryani) [dairy, root veg], Paneer biryani [dairy], Mushroom biryani [mushroom, dairy], Chicken biryani (hyderabadi chicken biryani) [non-veg; chicken, dairy], Mutton biryani [non-veg; mutton, dairy], Egg biryani [egg; egg, dairy], Fish biryani [non-veg; fish, dairy], Prawn biryani [non-veg; prawn]

**Suggested in its region:** Kolkata biryani [non-veg; chicken, mutton, root veg, egg, dairy; bengal], Malabar biryani (thalassery biryani) [non-veg; chicken, dairy, nuts; kerala], Ambur biryani (dindigul biryani) [non-veg; chicken, mutton, dairy; tamil]

### Khichdi
aka khichri, khichuri, khichadi, pongal, ven pongal, khara pongal, huggi, pongali; north, south, west, east; complete; breakfast, lunch, dinner; all: dairy

**Suggested:** Moong dal khichdi [rice], Masala khichdi [rice, onion/garlic, root veg], Vegetable khichdi [rice, root veg], Bajra khichdi [rajasthan], Dalia khichdi [wheat], Ven pongal (khara pongal, ghee pongal, huggi) [rice, nuts; south], Rava pongal [wheat, nuts; south], Millet pongal (thinai pongal, varagu pongal, samai pongal) [nuts; south], Oats pongal [nuts; south], Godhumai rava pongal (broken wheat pongal, dalia pongal) [wheat, nuts; south]

**Suggested in its region:** Gujarati khichdi (toor dal khichdi) [rice; gujarat], Bhuna khichuri (bhoger khichuri) [rice, root veg; bengal]

### Flavoured rice
aka variety rice, chitranna, kalanda sadam, mixed rice, bath, pulihora, sadam; south, odisha; complete; lunch, dinner, tiffin; all: rice

**Suggested:** Lemon rice (chitranna, elumichai sadam, nimmakaya pulihora) [peanut], Tamarind rice (puliyogare, puliyodharai, pulihora) [peanut, sugar], Coconut rice (thengai sadam, kayi anna) [coconut, nuts], Tomato rice (thakkali sadam, tomato bath) [onion/garlic], Bisi bele bath [dairy, nuts, root veg; karnataka], Vangi bath [brinjal, nuts; karnataka], Mango rice (mangai sadam, mavinakayi chitranna) [peanut], Sesame rice (ellu sadam), Pudina rice (mint rice) [onion/garlic], Capsicum rice

**Suggested in its region:** Pakhala (pakhala bhata) [odisha]

### Fried rice
aka chinese rice; indo-chinese; complete; lunch, dinner, tiffin; veg and non-veg; all: onion/garlic, rice, soy

**Suggested:** Veg fried rice, Schezwan fried rice, Paneer fried rice [dairy], Egg fried rice [egg; egg], Chicken fried rice [non-veg; chicken]

## Lunch and dinner: non-veg

### Chicken curry
aka murgh, kozhi curry, murgir jhol, kodi kura, chicken gravy; north, south, west, east; main; lunch, dinner; nonveg; all: chicken, onion/garlic

**Suggested:** Chicken curry (home-style chicken curry), Butter chicken (murgh makhani) [dairy, nuts, sugar], Chicken korma [dairy, nuts], Chicken do pyaza, Chicken saagwala (palak chicken)

**Suggested in its region:** Kadai chicken [north/punjab], Chettinad chicken [coconut; tamil], Nadan chicken curry (kerala chicken curry) [coconut; kerala], Chicken stew [coconut, root veg; kerala], Andhra chicken curry (kodi kura) [andhra], Kolhapuri chicken [coconut; maharashtra], Chicken xacuti [coconut; goa], Murgir jhol [root veg; bengal], Kosha murgi [dairy; bengal]

### Chicken fry
aka chicken dry, chicken roast, sukka, chicken varuval, chicken starter; north, south, west, east; main; lunch, dinner, snack; nonveg; all: chicken, onion/garlic

**Suggested:** Chicken fry (kozhi varuval), Chicken 65 [egg, dairy], Pepper chicken

**Suggested in its region:** Chicken sukka (kori sukka) [coconut; karnataka], Chicken ghee roast [dairy; karnataka], Kerala chicken roast [kerala]

**Recognised only:** Tandoori chicken [dairy], Chicken tikka [dairy]

### Mutton curry
aka gosht, mangsho, lamb curry, goat curry, mutton; north, south, west, east; main; lunch, dinner; nonveg; all: mutton

**Suggested:** Mutton curry (home-style mutton curry, goat curry) [onion/garlic], Mutton korma [onion/garlic, dairy, nuts], Dalcha [onion/garlic; andhra]

**Suggested in its region:** Rogan josh [onion/garlic, dairy; kashmir], Mutton yakhni [dairy; kashmir], Laal maas [onion/garlic, dairy; rajasthan], Kosha mangsho [onion/garlic, dairy; bengal], Mangshor jhol [onion/garlic, root veg; bengal], Mutton sukka [onion/garlic, coconut; karnataka], Kerala mutton roast [onion/garlic; kerala], Mutton stew [onion/garlic, coconut, root veg; kerala], Tambda rassa (kolhapuri mutton) [onion/garlic, coconut; maharashtra], Dhansak [onion/garlic, brinjal, sugar; parsi], Salli boti [onion/garlic, root veg, sugar; parsi]

### Keema
aka kheema, qeema, mince; north, west; main; breakfast, lunch, dinner; nonveg; all: onion/garlic

**Suggested:** Keema matar [mutton], Keema aloo (aloo keema) [mutton, root veg], Chicken keema [chicken], Keema pav [mutton, wheat; maharashtra]

### Pork
aka pork curry, sorpotel, vindaloo, pandi curry; goa, northeast, karnataka; main; lunch, dinner; nonveg; all: pork, onion/garlic

**Suggested:** Pork curry

**Suggested in its region:** Pork vindaloo [sugar; goa], Sorpotel [goa], Pandi curry (coorg pork curry) [karnataka], Smoked pork with bamboo shoot (naga pork) [northeast], Pork with akhuni (pork with axone) [soy; northeast]

### Fish curry
aka machli, meen curry, macher jhol, maach, chepala pulusu, ambot tik, tenga, mach; south, west, east, bengal, kerala, goa; main; lunch, dinner; nonveg; all: fish

**Suggested:** Fish masala curry (machli curry, machli ka salan) [onion/garlic]

**Suggested in its region:** Macher jhol (maacher jhol) [onion/garlic, root veg; bengal], Shorshe maach (shorshe ilish, mustard fish) [bengal], Doi maach [dairy, onion/garlic, sugar; bengal], Meen kuzhambu (meen kulambu) [onion/garlic; tamil], Kerala fish curry (meen curry, kudampuli fish curry) [onion/garlic, coconut; kerala], Fish moilee (meen molee) [onion/garlic, coconut; kerala], Goan fish curry [onion/garlic, coconut; goa], Ambot tik [onion/garlic; goa], Malvani fish curry [onion/garlic, coconut; maharashtra], Fish gassi (meen gassi) [onion/garlic, coconut; karnataka], Chepala pulusu [onion/garlic; andhra], Masor tenga [assam], Machha besara [onion/garlic; odisha]

### Fish fry
aka meen varuval, maach bhaja, tawa fish; south, west, east, bengal; side; lunch, dinner, snack; nonveg; all: fish

**Suggested:** Masala fish fry (tawa fish fry) [onion/garlic], Rava fish fry [wheat]

**Suggested in its region:** Meen varuval (meen varuthathu) [onion/garlic; south], Maach bhaja [bengal], Amritsari fish [onion/garlic, egg; punjab], Bombil fry (bombay duck fry) [wheat, rice; maharashtra], Pomfret fry (paplet fry) [onion/garlic, wheat; maharashtra/goa]

### Prawn
aka prawns, jhinga, chingri, kolambi, royyalu, eral, konju, shrimp; south, west, east, bengal, goa, kerala; main; lunch, dinner; nonveg; all: prawn, onion/garlic

**Suggested:** Prawn curry (eral kuzhambu, kolambi curry) [coconut], Prawn masala, Prawn fry (prawn rava fry, kolambi fry)

**Suggested in its region:** Chingri malai curry [coconut; bengal], Prawn balchao [sugar; goa], Prawn ghee roast [dairy; karnataka], Royyala iguru [andhra]

### Egg curry
aka anda curry, muttai kuzhambu, dimer dalna, egg masala; north, south, west, east; main; lunch, dinner; egg; all: egg, onion/garlic

**Suggested:** Egg curry (anda curry), Egg masala

**Suggested in its region:** Egg roast (mutta roast) [kerala], Egg stew [coconut, root veg; kerala], Dimer dalna (dimer jhol) [root veg; bengal], Muttai kuzhambu [tamil]

## Indo-Chinese and continental (eaten at home)

### Noodles
aka chowmein, hakka noodles, maggi, instant noodles; indo-chinese; complete; lunch, dinner, tiffin, snack; veg and non-veg; all: onion/garlic, wheat

**Suggested:** Hakka noodles (veg chowmein) [soy], Schezwan noodles [soy], Chilli garlic noodles [soy], Maggi (instant noodles), Vegetable maggi (masala maggi), Egg noodles (egg chowmein) [egg; egg, soy], Chicken noodles (chicken chowmein) [non-veg; chicken, soy]

### Pasta
aka macaroni; continental; complete; lunch, dinner, tiffin; veg and non-veg; all: wheat

**Suggested:** White sauce pasta [dairy], Red sauce pasta [onion/garlic], Pink sauce pasta [dairy, onion/garlic], Masala pasta (indian-style pasta) [onion/garlic], Macaroni (vegetable macaroni) [onion/garlic], Mac and cheese [dairy], Pesto pasta [dairy, nuts, onion/garlic], Chicken pasta [non-veg; chicken, dairy, onion/garlic]

### Manchurian
aka chilli, chinese, gobi manchurian, dry chilli; indo-chinese; main; dinner, snack; veg and non-veg; all: onion/garlic, soy

**Suggested:** Veg manchurian [wheat, root veg], Gobi manchurian [wheat], Chilli paneer [dairy, wheat], Chilli mushroom [mushroom], Chilli potato (honey chilli potato) [root veg, sugar], Chilli baby corn, Chilli chicken [non-veg; chicken, egg, wheat]

### Soup
aka shorba; continental, indo-chinese; side; dinner, snack; veg and non-veg; all: onion/garlic

**Suggested:** Tomato soup [dairy; continental], Sweet corn soup (veg sweet corn soup) [indo_chinese], Hot and sour soup [soy; indo_chinese], Manchow soup [soy, wheat; indo_chinese], Mixed vegetable soup (veg clear soup) [root veg], Palak soup (spinach soup) [dairy], Chicken soup (chicken clear soup) [non-veg; chicken]

## Sides (any meal)

### Raita
aka pachadi, thayir pachadi, perugu pachadi; north, south, west, east; side; lunch, dinner; all: dairy

**Suggested:** Boondi raita, Cucumber raita (kheera raita), Onion raita (onion tomato raita) [onion/garlic], Mixed vegetable raita [onion/garlic], Mint raita (pudina raita), Pineapple raita [sugar], Aloo raita [root veg], Lauki raita, Beetroot raita [root veg]

**Suggested in its region:** Vellarikka pachadi (cucumber pachadi, thayir pachadi) [coconut; south]

### Salad
aka kachumber, koshimbir, kosambari; north, south, west, east; side; lunch, dinner, tiffin, snack

**Suggested:** Kachumber (kachumber salad) [onion/garlic], Green salad (sliced salad) [onion/garlic], Koshimbir (kakdi koshimbir) [peanut, dairy; maharashtra], Kosambari (hesarubele kosambari) [coconut; karnataka], Sprouts salad (moong sprouts salad) [onion/garlic], Carrot salad [root veg], Beetroot salad [root veg], Corn salad (sweet corn salad), Cucumber salad (kakdi salad, kheera salad), Laccha onion (laccha pyaaz, onion salad) [onion/garlic], Fruit chaat (fruit salad), Chana salad (chickpea salad) [onion/garlic]

### Chutney
aka chatni, thogayal, thuvaiyal, chammanthi, podi, pachadi (andhra); north, south, west, east; side; breakfast, lunch, dinner, snack

**Suggested:** Coconut chutney (thengai chutney, kobbari pachadi) [coconut], Tomato chutney (thakkali chutney) [onion/garlic], Onion tomato chutney (kara chutney) [onion/garlic], Onion chutney (vengaya chutney) [onion/garlic], Mint chutney (pudina chutney, hari chutney) [onion/garlic], Coriander chutney (dhaniya chutney, green chutney), Peanut chutney (palli chutney, shenga chutney) [peanut, onion/garlic], Tamarind chutney (imli chutney, saunth) [sugar], Beerakaya pachadi (ridge gourd chutney) [onion/garlic; andhra], Idli podi (gunpowder, milagai podi, chutney powder) [south]

**Suggested in its region:** Gongura chutney (gongura pachadi) [onion/garlic; andhra], Dry garlic chutney (lasun chutney) [onion/garlic, coconut, peanut; maharashtra], Thecha (hirvi mirchi thecha) [onion/garlic, peanut; maharashtra], Shenga chutney pudi (peanut chutney powder) [peanut, onion/garlic; karnataka], Chammanthi (thenga chammanthi) [coconut, onion/garlic; kerala], Tomato khejur chutney (bengali tomato chutney) [sugar; bengal]

### Pickle
aka achar, achaar, oorugai, uppinakayi, avakaya, lonacha; north, south, west, east; side; breakfast, lunch, dinner, tiffin

**Suggested:** Mango pickle (aam ka achar, maangai oorugai), Lime pickle (nimbu achar, elumichai oorugai), Mixed pickle [root veg], Garlic pickle (lehsun achar) [onion/garlic], Green chilli pickle (hari mirch achar), Amla pickle, Carrot pickle (gajar achar) [root veg]

**Suggested in its region:** Avakaya [onion/garlic; andhra], Gongura pickle [onion/garlic; andhra], Sweet mango pickle (chhundo) [sugar; gujarat]

### Papad
aka appalam, pappadam, papadum, happala; north, south, west, east; side; lunch, dinner

**Suggested:** Roasted papad, Fried papad, Masala papad [onion/garlic], Sabudana papad, Rice papad [rice]

**Suggested in its region:** Appalam [tamil], Pappadam [kerala]

### Buttermilk
aka chaas, chhachh, mor, majjige, taak, lassi; north, south, west, east; drink; lunch, dinner, snack

**Suggested:** Chaas (buttermilk, chhachh, taak) [dairy], Masala chaas (spiced buttermilk) [dairy], Sweet lassi [dairy, sugar], Salted lassi [dairy]

**Suggested in its region:** Neer mor (majjige) [dairy; south], Sol kadhi [coconut; maharashtra/goa]

## Snacks and tiffin box

### Fruit
aka phal, cut fruit; north, south, west, east, continental; snack; breakfast, tiffin, snack

**Suggested:** Seasonal fruit (cut fruit), Banana, Apple slices, Papaya, Fruit custard [dairy, sugar]

### Roll
aka frankie, kathi roll, wrap; north, bengal, west; complete; tiffin, dinner, snack; veg and non-veg; all: wheat

**Suggested:** Paneer roll (paneer frankie) [dairy, onion/garlic], Veg frankie [root veg, onion/garlic], Aloo roll [root veg], Chapati roll (roti roll, sabzi roll), Egg roll (anda roll) [egg; egg, onion/garlic; bengal], Chicken kathi roll (chicken roll) [non-veg; chicken, onion/garlic]

### Namkeen
aka chivda, mixture, farsan, chakli, murukku, dry snack, makhana, phool makhana, fox nuts, lotus seeds; north, south, west, east; snack; tiffin, snack

**Suggested:** Poha chivda (chivda) [rice, peanut, nuts, sugar], Cornflakes chivda [peanut, nuts, sugar], Murmura chivda (puffed rice chivda, kurmura) [rice, peanut], Mixture (south indian mixture, madras mixture) [peanut], Khakhra [wheat; gujarat], Mathri [wheat; north], Chakli (murukku) [rice], Banana chips (nendran chips) [kerala], Shankarpali (shakkarpara) [wheat, sugar, dairy; maharashtra], Bhakarwadi [wheat, sugar; maharashtra], Masala peanuts [peanut], Roasted chana (bhuna chana), Roasted makhana [dairy; north], Masala makhana [dairy; north]

### Cutlet
aka tikki, patties; north, south, west, east; snack; tiffin, snack; veg and non-veg; all: root veg

**Suggested:** Veg cutlet (vegetable cutlet) [wheat], Aloo tikki, Poha cutlet [rice], Beetroot cutlet [wheat], Paneer cutlet [dairy, wheat], Fish cutlet [non-veg; fish, wheat, egg], Chicken cutlet [non-veg; chicken, wheat, egg]

### Pakora
aka pakoda, bhajji, bajji, bhajiya, bonda, fritters; north, south, west, east; snack; snack

**Suggested:** Onion pakora (kanda bhaji, pyaaz pakoda, onion bajji) [onion/garlic], Aloo pakora (aloo bajji) [root veg], Palak pakora, Paneer pakora [dairy], Gobi pakora, Mirchi bajji (mirchi pakora, mirchi vada), Moong dal pakoda [onion/garlic], Bread pakora [wheat, root veg], Aloo bonda (batata bonda) [root veg], Mysore bonda [wheat, dairy]

**Suggested in its region:** Punugulu [rice, onion/garlic; andhra], Goli baje (mangalore bajji) [wheat, dairy; karnataka]

### Samosa
aka singara, shingara; north, east; snack; snack; veg and non-veg; all: wheat

**Suggested:** Aloo samosa (punjabi samosa) [root veg], Onion samosa [onion/garlic; andhra], Patti samosa [onion/garlic], Keema samosa [non-veg; mutton, onion/garlic]

**Suggested in its region:** Shingara [root veg, peanut; bengal]

### Vada
aka vadai, wada; south, west; snack; breakfast, snack

**Suggested:** Medu vada (uzhunnu vada, ulundu vadai) [onion/garlic], Masala vada (paruppu vadai, dal vada) [onion/garlic], Sambar vada (sambar vadai) [onion/garlic], Batata vada (aloo vada) [root veg, onion/garlic], Rava vada [wheat, onion/garlic], Sabudana vada [peanut, root veg; maharashtra/gujarat/north]

**Suggested in its region:** Maddur vada [wheat, onion/garlic; karnataka]

### Chaat
aka chat; north, west, east; snack; snack

**Suggested:** Bhel puri (bhel) [rice, onion/garlic, sugar], Sev puri [wheat, root veg, onion/garlic, sugar], Pani puri (golgappa, puchka) [wheat, root veg], Dahi puri [wheat, dairy, sugar, root veg], Papdi chaat [wheat, dairy, sugar, root veg], Raj kachori [wheat, dairy, sugar, root veg], Aloo tikki chaat [root veg, dairy, sugar], Dahi vada (dahi bhalla, thayir vadai) [dairy, sugar], Ragda pattice [root veg, onion/garlic], Chana chaat (kala chana chaat) [onion/garlic], Masala corn (corn chaat, bhutta) [dairy], Sweet potato chaat (shakarkandi chaat) [root veg]

**Suggested in its region:** Jhal muri [rice, onion/garlic, peanut; bengal]

### Sundal
aka sundal; tamil; snack; tiffin, snack; all: coconut

**Suggested:** Chana sundal (kondakadalai sundal), Peanut sundal (verkadalai sundal) [peanut], Karamani sundal (lobia sundal), Pattani sundal (peas sundal), Pachai payaru sundal (green moong sundal)

## Sweets

### Kheer
aka payasam, payesh, payas, kheeri, pradhaman; north, south, west, east; sweet; lunch, dinner, snack; all: nuts, sugar

**Suggested:** Rice kheer (chawal ki kheer, paal payasam, payesh) [rice, dairy], Semiya payasam (seviyan kheer, vermicelli kheer) [wheat, dairy], Sabudana kheer (javvarisi payasam) [dairy], Makhana kheer [dairy], Lauki kheer [dairy], Parippu payasam [coconut, dairy; kerala]

**Suggested in its region:** Phirni [rice, dairy; north], Ada pradhaman [rice, coconut; kerala], Sakkarai pongal (sweet pongal, chakkara pongali) [rice, dairy; south]

### Halwa
aka sheera, shira, kesari, kesari bath, halua; north, south, west, east; sweet; breakfast, lunch, dinner, snack; all: dairy, nuts, sugar

**Suggested:** Suji halwa (sooji halwa, sheera, shira) [wheat], Aate ka halwa (atte ka sheera) [wheat], Gajar halwa (gajar ka halwa) [root veg], Moong dal halwa, Lauki halwa (dudhi halwa)

**Suggested in its region:** Rava kesari (kesari bath, kesari) [wheat; south], Pineapple kesari [wheat; south], Banana sheera [wheat; maharashtra]

### Ladoo
aka laddu, unde, naru; north, south, west, east; sweet; snack

**Suggested:** Besan ladoo [dairy, sugar, nuts], Rava ladoo [wheat, dairy, coconut, sugar, nuts], Coconut ladoo (nariyal ladoo, narkel naru) [coconut, sugar, dairy], Til ladoo (til gul) [sugar, peanut], Dry fruit ladoo [nuts], Atta ladoo (pinni, aate ke ladoo) [wheat, dairy, sugar, nuts], Gond ladoo [wheat, dairy, sugar, nuts], Ragi ladoo [dairy, sugar, nuts], Peanut ladoo (shenga ladoo) [peanut, sugar]

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

## Open questions

Grain choices still open. Points already decided are in the section above.

1. **Small kinds kept on purpose**: Curd (1 item, a staple) and Mudde (2, a staple). Folded so far: Pesarattu, Adai and Uttapam into Dosa; Gravy sabzi, Paneer and Kofta curry into Gravy; Handvo into Dhokla; Pithla/zunka into Dal; Makhana into Namkeen; Sabudana into Upma, Vada and Thalipeeth; Misal and Pav bhaji into Pav meal; Dalia and Oats into Upma, Khichdi and Porridge.
2. **Regional or not**: some calls were close. Dal makhani, phirni and kadai chicken are marked regional (north); Mysore masala dosa, kara kuzhambu and Puneri and Kolhapuri misal are suggested to everyone (flavour-base variants), not marked regional. Items already narrow and suggested on their own (pesarattu, gatte, mochar ghonto, sabudana khichdi) are not marked regional, but their cuisines narrow them the same way. Should they be marked regional too?
3. **Prawn curry and prawn fry are both suggested**, as different dishes of one kind. Chicken fry and fish fry, by contrast, are their own kinds.
4. **Contents err towards safety**: parathas and theplas carry dairy (ghee or curd); rava upma carries both cashew and peanut.
5. **Kanchipuram idli** is kept recognised only as the same batter as idli with spices added. If the owner counts its pepper-cumin-ghee seasoning as a flavour base, it becomes suggestable (tamil, regional). Same question for **sambar idli** (kept back because it needs a sambar plate).
6. **Left out**: dal-baati-churma, dal dhokli, parotta, naan/kulcha, store sweets (gulab jamun, rasgulla), mishti doi, shrikhand. Curd rice was removed (rice + curd).
7. **Grain tags**: rava, maida, sooji, pav and bread are tagged wheat; poha, puffed rice and rice flour are tagged rice; ragi, jowar, bajra and millets are untagged. Brown and matta rice are not tagged rice.
