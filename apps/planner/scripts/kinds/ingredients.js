// Ingredients of every catalog item, as usually made in an Indian home (owner, 26 Nov: decided 21). gen-kinds.js reads this
// file and DERIVES each item's contents from it: `contains` from all its ingredients, `contains_main` from its main ones.
//
// Item notation: "Name: main, main | leave-out, leave-out". Before the bar: the MAIN ingredients (the dish is not itself
// without them: mooli in mooli thepla, onion in kanda poha, paneer in paneer bhurji). After it: the LEAVE-OUT-ABLE ones (a
// garnish, a tempering or an add-in the dish is still itself without: cashews in upma, peanuts and onion in vegetable poha,
// ghee on top, coriander). Salt, oil, water, turmeric, chilli and the everyday spices are left out unless they matter for a
// rule; ghee only where it is the dish's way. 3-8 ingredients, specific names (toor dal, sooji, mooli).
//
// INGREDIENT_TAGS: every ingredient named below and the content tags it brings (gen-kinds.js refuses an ingredient it does
// not know, so each one is classified once, here). An ingredient with no tag is in PLAIN.

const INGREDIENT_TAGS = {
  white_rice: "rice; idli rice; basmati rice; raw rice; boiled rice; poha; rice flour; puffed rice; rice rava",
  wheat: "atta; maida; sooji; bread; pav; broken wheat; vermicelli; noodles; pasta; macaroni; wheat flakes; chocos; multigrain atta; muesli; breadcrumbs; papdi; puri shells; sev puri shells; khakhra; wheat flour; samosa pastry",
  dairy: "ghee; butter; curd; milk; paneer; cream; malai; cheese; khoa; buttermilk; condensed milk; milk powder",
  nuts: "cashews; almonds; pistachios; walnuts; dry fruits; chironji",
  peanut: "peanuts; peanut butter",
  onion_garlic: "onion; garlic; shallots; spring onion; fried onions; ginger garlic paste",
  root_veg: "onion; garlic; shallots; spring onion; fried onions; ginger garlic paste; potato; sweet potato; carrot; beetroot; mooli; yam; elephant foot yam; arbi; turnip; tapioca; ginger; lotus stem",
  sugar: "sugar; jaggery; honey; jam; condensed milk; ketchup; sweet chutney; dates; chocos",
  coconut: "coconut; coconut milk; dry coconut",
  mushroom: "mushroom",
  brinjal: "brinjal",
  karela: "karela",
  soy: "soy sauce; soya chunks; akhuni",
  egg: "egg",
  chicken: "chicken",
  mutton: "mutton; mutton keema",
  pork: "pork",
  fish: "fish; bombil; pomfret; hilsa; rohu; dry fish; mackerel",
  prawn: "prawns",
};
const PLAIN = `urad dal; toor dal; moong dal; masoor dal; chana dal; whole moong; rajma; chickpeas; kala chana; lobia; white peas; green peas;
  matki; horse gram; sprouts; black-eyed beans; besan; sattu; ragi flour; jowar flour; bajra flour; makki atta; oats; millet;
  sabudana; makhana; corn; cornflakes; baby corn; sweet corn; tomato; cauliflower; cabbage; capsicum; french beans; okra; lauki; tinda; turai;
  parwal; pumpkin; drumstick; drumstick leaves; spinach; methi; dill; amaranth; cucumber; raw mango; mango; lemon; tamarind; gongura;
  chow chow; snake gourd; ivy gourd; raw banana; banana flower; jackfruit; mustard greens; collard greens; papaya; pineapple; apple; banana;
  seasonal fruit; ker; sangri; sev; boondi; papad; mint; coriander; curry leaves; green chilli; red chilli; mustard paste; poppy seeds; sesame;
  vadi; pepper; cumin; dal vada; gond; raisins; bamboo shoot; dosa batter; idli batter; podi; urad papad; rice papad dough; tea; saffron;
  kokum; raw papaya; brown rice; matta rice; bell pepper; basil; mixed vegetables; mango pulp; cucumber seeds; jowar; pulses; fruit; amla; lime; garlic chives; bajra; vinegar; mustard oil`;

// Kind by kind, in the catalog's order.
const ITEMS = `
## Idli
Idli: idli rice, urad dal
Rava idli: sooji, curd | cashews, carrot, ghee
Kanchipuram idli: idli rice, urad dal | cashews, ghee
Mini idli: idli rice, urad dal | ghee
Ghee podi idli: idli rice, urad dal, ghee, podi
Ragi idli: ragi flour, idli rice, urad dal
Oats idli: oats, sooji, curd | carrot, cashews
Thatte idli: idli rice, urad dal | ghee
Sambar idli: idli rice, urad dal, toor dal | onion, shallots, ghee

## Dosa
Plain dosa: idli rice, urad dal | ghee
Masala dosa: idli rice, urad dal, potato | onion, ghee
Mysore masala dosa: idli rice, urad dal, potato, red chilli | onion, garlic, ghee, butter
Ghee roast dosa: idli rice, urad dal, ghee
Benne dosa: idli rice, urad dal, butter | potato
Onion dosa: idli rice, urad dal, onion | ghee
Rava dosa: sooji, rice flour | onion, cashews, ghee
Set dosa: idli rice, urad dal, poha | butter
Neer dosa: raw rice, coconut
Ragi dosa: ragi flour, idli rice, urad dal | onion
Wheat dosa: atta | onion, green chilli
Kal dosai: idli rice, urad dal
Egg dosa: idli rice, urad dal, egg | onion
Pesarattu: whole moong, rice | onion, ginger, green chilli
Upma pesarattu: whole moong, rice, sooji | onion, ginger, cashews
Adai: rice, toor dal, chana dal, urad dal | onion, shallots
Vegetable adai: rice, toor dal, chana dal | carrot, onion, cabbage
Murungai keerai adai: rice, toor dal, chana dal, drumstick leaves | onion
Onion uttapam: idli rice, urad dal, onion | ghee
Tomato uttapam: idli rice, urad dal, tomato | onion
Mixed vegetable uttapam: idli rice, urad dal, tomato, capsicum | onion, carrot
Plain uttapam: idli rice, urad dal | ghee
Rava uttapam: sooji, curd | onion, tomato
Podi uttapam: idli rice, urad dal, podi | ghee

## Upma
Rava upma: sooji | cashews, peanuts, onion, ghee, curry leaves
Vegetable upma: sooji, mixed vegetables | carrot, green peas, onion, cashews, ghee
Semiya upma: vermicelli | onion, carrot, green peas, cashews
Dalia upma: broken wheat | onion, carrot, green peas
Rice upma: rice rava | coconut, onion, urad dal
Bread upma: bread, tomato | onion
Oats upma: oats | carrot, onion, green peas
Idli upma: idli rice, urad dal | onion, curry leaves
Sabudana khichdi: sabudana, potato | peanuts, green chilli

## Poha
Kanda poha: poha, onion | peanuts, curry leaves, coriander
Batata poha: poha, potato | onion, peanuts
Indori poha: poha | onion, sugar, peanuts, sev
Dadpe pohe: poha, coconut | onion
Matar poha: poha, green peas | onion, peanuts
Vegetable poha: poha | onion, peanuts, potato, carrot, green peas
Aval upma: poha | onion, peanuts, curry leaves
Avalakki oggarane: poha | onion, peanuts, coconut
Aval nanachathu: poha, coconut, jaggery
Chire bhaja: poha | onion, peanuts
Doi chire: poha, curd | sugar, banana

## Paratha
Aloo paratha: atta, potato | ghee, butter, onion
Gobi paratha: atta, cauliflower | ghee, butter
Methi paratha: atta, methi | ghee, curd
Paneer paratha: atta, paneer | ghee, butter
Mooli paratha: atta, mooli | ghee, butter
Palak paratha: atta, spinach | ghee
Pyaaz paratha: atta, onion | ghee, butter
Mixed vegetable paratha: atta, mixed vegetables | potato, carrot, ghee
Dal paratha: atta, chana dal | ghee
Lachha paratha: atta, ghee
Matar paratha: atta, green peas | ghee
Sattu paratha: atta, sattu | onion, garlic, ghee
Sindhi koki: atta | onion, ghee
Egg paratha: atta, egg | onion, ghee
Keema paratha: atta, mutton keema | onion, ghee

## Thepla
Methi thepla: atta, methi | curd, ghee
Plain thepla: atta | curd, ghee
Dudhi thepla: atta, lauki | curd, ghee
Palak thepla: atta, spinach | curd, ghee
Bajra methi thepla: bajra flour, atta, methi | curd, ghee
Mooli thepla: atta, mooli | curd, ghee

## Thalipeeth
Bhajani thalipeeth: jowar flour, rice flour, besan, atta | onion, butter
Jowar thalipeeth: jowar flour, besan | onion
Methi thalipeeth: jowar flour, rice flour, atta, methi | onion
Kakdi thalipeeth: cucumber, rice flour | onion
Sabudana thalipeeth: sabudana, potato | peanuts

## Chilla
Besan chilla: besan | onion, tomato
Moong dal chilla: moong dal | onion, ginger
Paneer chilla: besan, paneer | onion
Rava chilla: sooji, curd | onion
Oats chilla: oats, besan | onion
Vegetable chilla: besan, mixed vegetables | onion, carrot

## Appam
Appam: raw rice, coconut | sugar
Kallappam: raw rice, coconut | sugar
Rava appam: sooji, coconut | sugar

## Puttu
Rice puttu: rice flour, coconut
Wheat puttu: wheat flour, coconut
Ragi puttu: ragi flour, coconut
Corn puttu: corn, coconut

## Idiyappam
Idiyappam: rice flour | coconut
Ragi idiyappam: ragi flour, rice flour | coconut
Wheat idiyappam: wheat flour | coconut
Lemon sevai: rice flour, lemon | peanuts
Coconut sevai: rice flour, coconut | cashews

## Kozhukattai
Pidi kozhukattai: rice flour | coconut
Ammini kozhukattai: rice flour | coconut
Ulundu kozhukattai: rice flour, urad dal | coconut
Sweet kozhukattai: rice flour, coconut, jaggery | ghee

## Akki roti
Akki roti: rice flour | onion, coconut, dill
Ragi roti: ragi flour | onion
Sabsige akki roti: rice flour, dill | onion, coconut
Pathiri: rice flour | coconut

## Paniyaram
Kara paniyaram: idli rice, urad dal | onion
Sweet paniyaram: idli rice, urad dal, jaggery
Rava appe: sooji, curd | onion
Ragi paniyaram: ragi flour, idli rice | onion

## Puri
Puri: atta
Masala puri: atta
Palak puri: atta, spinach
Luchi: maida
Radhaballabhi: maida, urad dal
Bedmi puri: atta, urad dal
Bhatura: maida, curd
Pakwan: maida
Mangalore buns: maida, banana, sugar, curd

## Kachori
Khasta kachori: maida, moong dal
Pyaaz kachori: maida, onion
Matar kachori: maida, green peas
Hing kochuri: maida, urad dal
Aloo kachori: maida, potato

## Porridge
Oats porridge: oats, milk | sugar
Overnight oats: oats, milk | sugar, honey, almonds
Sweet milk dalia: broken wheat, milk, sugar | almonds, cashews
Ragi malt: ragi flour, milk | jaggery
Lapsi: broken wheat, ghee, jaggery | almonds

## Cereal
Cornflakes with milk: cornflakes, milk | sugar
Muesli: muesli, milk | almonds, honey
Chocos: chocos, milk
Wheat flakes: wheat flakes, milk | sugar

## Toast
Bread butter toast: bread, butter
Bread jam: bread, jam | butter
French toast: bread, egg, milk | sugar
Masala toast: bread, potato | onion, butter, cheese
Peanut butter toast: bread, peanut butter | honey
Cheese toast: bread, cheese | butter

## Sandwich
Vegetable sandwich: bread, cucumber, tomato | butter, mint, potato, onion
Bombay sandwich: bread, potato, cucumber, tomato | butter, beetroot, onion, cheese
Grilled cheese sandwich: bread, cheese | butter
Paneer sandwich: bread, paneer | butter, onion
Aloo sandwich: bread, potato | butter
Corn sandwich: bread, sweet corn | cheese, butter
Chutney sandwich: bread, mint, coriander | butter
Egg sandwich: bread, egg | butter
Chicken sandwich: bread, chicken | egg, butter

## Eggs
Masala omelette: egg | onion, tomato
Plain omelette: egg
Egg bhurji: egg | onion, tomato
Boiled eggs: egg
Half fry: egg
Bread omelette: bread, egg | onion
Akuri: egg | onion, butter, cream
Egg podimas: egg | onion, curry leaves
Scrambled eggs: egg | butter, milk
Egg curry: egg, tomato | onion, garlic
Egg masala: egg, tomato | onion, garlic
Egg roast: egg | onion, garlic
Egg stew: egg, coconut milk | potato, onion, carrot
Dimer dalna: egg, potato | onion, garlic
Muttai kuzhambu: egg, tamarind | shallots, garlic

## Dhokla
Khaman dhokla: besan | sugar
Khatta dhokla: rice, urad dal, curd
Rava dhokla: sooji, curd
Moong dal dhokla: moong dal
Sandwich dhokla: rice, urad dal, curd
Khandvi: besan, buttermilk | coconut
Methi muthia: atta, besan, methi | sugar, curd
Dudhi muthia: atta, besan, lauki | sugar, curd
Handvo: rice, toor dal, curd, lauki | sugar
Rava handvo: sooji, curd, lauki
Vegetable handvo: rice, toor dal, curd, mixed vegetables | carrot, sugar

## Pav meal
Misal pav: pav, matki | onion, sev
Puneri misal: pav, matki, poha | onion, jaggery, sev
Kolhapuri misal: pav, matki | onion, garlic, dry coconut, sev
Usal pav: pav, white peas | onion, garlic
Pav bhaji: pav, mixed vegetables, potato | butter, onion, garlic
Jain pav bhaji: pav, mixed vegetables, raw banana | butter
Masala pav: pav, tomato | onion, butter
Dabeli: pav, potato | peanuts, sweet chutney, onion
Vada pav: pav, potato, besan | garlic

## Pitha
Patishapta: rice flour, maida, coconut, jaggery | khoa
Puli pitha: rice flour, coconut, jaggery
Bhapa pitha: rice flour, coconut, jaggery
Chitoi pitha: rice flour
Til pitha: rice flour, sesame, jaggery
Enduri pitha: rice, urad dal, coconut, jaggery
Chakuli pitha: rice, urad dal
Poda pitha: rice, urad dal, coconut, jaggery

## Roti
Phulka: atta
Chapati: atta | ghee
Ghee roti: atta, ghee
Missi roti: atta, besan | onion
Makki ki roti: makki atta | butter
Multigrain roti: multigrain atta

## Bhakri
Jowar bhakri: jowar flour
Bajra bhakri: bajra flour
Nachni bhakri: ragi flour
Rice bhakri: rice flour
Wheat bhakri: atta

## Rice
Steamed rice: rice
Jeera rice: basmati rice, cumin | ghee
Brown rice: brown rice
Matta rice: matta rice

## Curd
Curd: curd

## Mudde
Ragi mudde: ragi flour
Ragi sangati: ragi flour, rice

## Dal
Moong dal: moong dal | onion, garlic, ghee
Masoor dal: masoor dal | onion, garlic, tomato
Toor dal: toor dal | tomato, onion, garlic, ghee
Chana dal: chana dal | onion, garlic, ghee
Mixed dal: toor dal, moong dal, masoor dal, chana dal | onion, garlic, ghee
Panchmel dal: toor dal, moong dal, chana dal, urad dal, masoor dal | ghee, onion, garlic
Dal tadka: toor dal | ghee, onion, garlic, tomato
Dal fry: toor dal, tomato | onion, garlic
Dal makhani: urad dal, rajma, butter, cream | onion, garlic
Palak dal: toor dal, spinach | onion, garlic
Lauki chana dal: chana dal, lauki | onion, garlic
Khatti dal: toor dal, tamarind | garlic
Gujarati dal: toor dal, jaggery | peanuts
Varan: toor dal | ghee
Amti: toor dal, kokum, jaggery | coconut
Muddha pappu: toor dal | ghee
Tomato pappu: toor dal, tomato | onion, garlic
Palakura pappu: toor dal, spinach | garlic, onion
Mamidikaya pappu: toor dal, raw mango | onion, garlic
Dosakaya pappu: toor dal, cucumber | onion, garlic
Paruppu: toor dal | ghee
Kerala parippu curry: moong dal, coconut | shallots, ghee
Tovve: toor dal | ghee
Cholar dal: chana dal | coconut, ghee, sugar, raisins
Bengali masoor dal: masoor dal | onion, garlic
Sona moong dal: moong dal | ghee
Dalma: toor dal, mixed vegetables, raw papaya, pumpkin | potato, brinjal, coconut
Sai bhaji: chana dal, spinach, dill, mixed vegetables | onion, garlic, potato, brinjal
Rajma: rajma, tomato | onion, garlic, ginger
Jammu rajma: rajma, tomato | onion, garlic
Chole: chickpeas, tomato | onion, garlic, ginger
Pindi chole: chickpeas | onion, garlic, ginger
Kala chana curry: kala chana, tomato | onion, garlic
Lobia: lobia, tomato | onion, garlic
Safed matar: white peas | onion, garlic
Ghugni: white peas | onion, garlic, potato, coconut
Matki usal: matki | onion, garlic, coconut
Moong usal: whole moong | onion, garlic, coconut
Vatana usal: white peas | onion, garlic, coconut
Kadala curry: kala chana, coconut | shallots, garlic
Chana ghassi: kala chana, coconut
Sprouts curry: sprouts, tomato | onion, garlic
Pithla: besan | onion, garlic
Zunka: besan, onion | garlic

## Rice curry
Drumstick sambar: toor dal, drumstick, tamarind | shallots
Mixed vegetable sambar: toor dal, mixed vegetables, tamarind | potato, carrot, shallots
Onion sambar: toor dal, shallots, tamarind
Radish sambar: toor dal, mooli, tamarind | onion
Brinjal sambar: toor dal, brinjal, tamarind | onion
Pumpkin sambar: toor dal, pumpkin, tamarind | onion
Okra sambar: toor dal, okra, tamarind | onion
Tiffin sambar: toor dal, moong dal, tomato | onion
Arachuvitta sambar: toor dal, coconut, tamarind | shallots
Udupi sambar: toor dal, coconut, jaggery
Kerala sambar: toor dal, coconut, mixed vegetables | shallots
Tomato rasam: tomato, tamarind | garlic, toor dal
Pepper rasam: pepper, tamarind | garlic
Lemon rasam: lemon, toor dal
Garlic rasam: garlic, tamarind | toor dal
Mysore rasam: toor dal, tomato, coconut | ghee
Paruppu rasam: toor dal, tomato, tamarind
Pineapple rasam: pineapple, toor dal | sugar
Jeera rasam: cumin, tamarind | toor dal
Udupi saaru: toor dal, tomato | jaggery
Kollu rasam: horse gram | garlic
Vatha kuzhambu: tamarind | shallots, garlic
Kara kuzhambu: tamarind | shallots, garlic
Poondu kuzhambu: garlic, tamarind | shallots
Ennai kathirikai kuzhambu: brinjal, tamarind | shallots, garlic
Paruppu urundai kuzhambu: toor dal, chana dal, tamarind | shallots, garlic
Puli kuzhambu: tamarind | shallots, garlic
Sorakaya pulusu: lauki, tamarind | onion
Bendakaya pulusu: okra, tamarind | onion
Mukkala pulusu: mixed vegetables, tamarind | brinjal, potato, onion, jaggery
Pineapple gojju: pineapple, tamarind, jaggery
Hagalakai gojju: karela, tamarind, jaggery
Chow chow kootu: chow chow, moong dal, coconut
Poricha kootu: mixed vegetables, moong dal, coconut
Keerai kootu: amaranth, moong dal, coconut
Pudalangai kootu: snake gourd, moong dal, coconut
Kathirikai kootu: brinjal, moong dal, coconut
Cabbage kootu: cabbage, moong dal, coconut
Punjabi kadhi pakora: curd, besan | onion, garlic
Gujarati kadhi: curd, besan | sugar
Rajasthani kadhi: curd, besan
Maharashtrian kadhi: curd, besan
Sindhi kadhi: besan, mixed vegetables, tamarind | potato, drumstick
Mor kuzhambu: curd, coconut
Majjige huli: curd, coconut
Pulissery: curd, coconut

## Sabzi
Bhindi sabzi: okra | onion
Aloo gobi: potato, cauliflower | onion, garlic
Jeera aloo: potato
Aloo methi: potato, methi | garlic
Aloo bhaji: potato | onion
Lauki sabzi: lauki, tomato
Tinda sabzi: tinda | onion
Turai sabzi: turai | onion
Parwal sabzi: parwal | onion
Karela sabzi: karela | onion
Cabbage sabzi: cabbage | green peas, onion
Beans sabzi: french beans
Gajar matar: carrot, green peas
Kaddu sabzi: pumpkin | jaggery
Arbi sabzi: arbi
Baingan aloo: brinjal, potato | onion
Aloo shimla mirch: potato, capsicum
Kundru sabzi: ivy gourd | onion
Mixed vegetable sabzi: mixed vegetables | potato, carrot, onion
Suran sabzi: elephant foot yam
Ker sangri: ker, sangri
Haak: collard greens
Bateta nu shaak: potato | sugar
Methi bhaji: methi | onion, garlic
Beans poriyal: french beans | coconut
Cabbage thoran: cabbage, coconut
Carrot poriyal: carrot | coconut
Beetroot poriyal: beetroot | coconut
Vazhakkai poriyal: raw banana
Urulaikizhangu roast: potato
Senai roast: elephant foot yam
Keerai poriyal: amaranth | coconut
Kovakkai fry: ivy gourd | onion
Bendakaya vepudu: okra | onion
Dondakaya vepudu: ivy gourd | onion, peanuts
Shukto: karela, raw banana | brinjal, sweet potato, milk, sugar, mustard paste
Chorchori: mixed vegetables | potato, brinjal
Lau ghonto: lauki | milk
Mochar ghonto: banana flower | potato, coconut
Aloo posto: potato, poppy seeds
Bandhakopir torkari: cabbage | potato, green peas
Paneer bhurji: paneer | onion, tomato
Begun bhaja: brinjal
Alu bhaja: potato
Potol bhaja: parwal
Uchhe bhaja: karela
Kumro bhaja: pumpkin
Beguni: brinjal, besan
Baingan bharta: brinjal | onion, garlic, tomato
Baingan chokha: brinjal | garlic, onion
Aloo chokha: potato | onion, mustard oil
Tomato chokha: tomato | garlic, onion
Aloo pitika: potato | onion
Begun pora: brinjal | onion
Vangyache bharit: brinjal | onion, peanuts
Eromba: dry fish, mixed vegetables | potato
Bharwa bhindi: okra | onion
Bharwa baingan: brinjal | onion
Bharwa karela: karela | onion
Bharwa tinda: tinda | onion
Bharwa parwal: parwal | onion
Stuffed capsicum: capsicum, potato | onion
Gutti vankaya: brinjal, peanuts | onion
Bharli vangi: brinjal, peanuts, coconut | onion
Bharela ringan bateta: brinjal, potato, peanuts | sugar

## Gravy
Aloo matar: potato, green peas, tomato | onion, garlic
Aloo tamatar: potato, tomato
Aloo palak: potato, spinach | onion, garlic
Dum aloo: potato, curd | onion, garlic
Kashmiri dum aloo: potato, curd
Matar mushroom: mushroom, green peas | onion, garlic
Mushroom masala: mushroom, tomato | onion, garlic
Mix veg curry: mixed vegetables, tomato | potato, carrot, onion, garlic
Vegetable kurma: mixed vegetables, coconut | cashews, potato, carrot, onion, garlic
Baingan masala: brinjal, tomato | onion, garlic
Methi matar malai: methi, green peas, cream, cashews | onion
Kathal sabzi: jackfruit | onion, garlic, potato
Soya chunks curry: soya chunks, tomato | onion, garlic
Sarson da saag: mustard greens, spinach | butter, garlic, onion
Gatte ki sabzi: besan, curd | onion, garlic
Papad ki sabzi: papad, curd
Sev tameta: sev, tomato | onion, sugar
Undhiyu: mixed vegetables, sweet potato, yam, brinjal, atta, methi | peanuts, coconut, sugar, garlic
Aloo dalna: potato, tomato | ghee, sugar
Potol dalna: parwal | potato, ghee, sugar
Santula: mixed vegetables, raw papaya | potato, brinjal
Papaya khar: raw papaya
Nadru yakhni: lotus stem, curd
Khatkhate: mixed vegetables, coconut, kokum | sweet potato, yam
Palak paneer: paneer, spinach | onion, garlic, cream
Matar paneer: paneer, green peas, tomato | onion, garlic
Paneer butter masala: paneer, tomato, butter, cream | cashews, sugar, onion, garlic
Kadai paneer: paneer, capsicum, tomato | onion, garlic
Shahi paneer: paneer, cream, cashews | onion, garlic, almonds
Paneer tikka masala: paneer, curd, tomato | onion, garlic, cream
Paneer do pyaza: paneer, onion | garlic, tomato
Achari paneer: paneer, curd | onion, garlic
Lauki kofta: lauki, besan, tomato | onion, garlic
Malai kofta: paneer, potato, cream, cashews | onion, garlic, raisins
Paneer kofta: paneer, tomato | onion, garlic, cream
Palak kofta: spinach, besan, tomato | onion, garlic
Raw banana kofta: raw banana, besan, tomato | onion, garlic
Aviyal: mixed vegetables, coconut, curd | yam, drumstick, carrot
Olan: pumpkin, lobia, coconut milk
Erissery: pumpkin, coconut | lobia
Kalan: raw banana, yam, curd, coconut
Kootu curry: kala chana, raw banana, coconut | yam
Vegetable stew: potato, coconut milk | carrot, onion, green peas
Ulli theeyal: shallots, coconut, tamarind
Pavakka theeyal: karela, coconut, tamarind | shallots
Kappa puzhukku: tapioca, coconut

## Pulao
Vegetable pulao: basmati rice, mixed vegetables | carrot, potato, onion, ghee
Matar pulao: basmati rice, green peas | ghee, onion
Paneer pulao: basmati rice, paneer | ghee, onion
Chana pulao: basmati rice, chickpeas | onion
Kashmiri pulao: basmati rice, ghee, milk, sugar | cashews, almonds, raisins, saffron
Ghee rice: basmati rice, ghee | cashews, onion, raisins
Coconut milk pulao: basmati rice, coconut milk | onion, mixed vegetables
Basanti pulao: basmati rice, ghee, sugar | cashews, raisins
Tawa pulao: rice, mixed vegetables, tomato | butter, potato, onion
Yakhni pulao: basmati rice, mutton | curd, onion, ghee
Chicken pulao: basmati rice, chicken | curd, onion, ghee

## Biryani
Veg biryani: basmati rice, mixed vegetables | curd, fried onions, ghee, potato
Paneer biryani: basmati rice, paneer | curd, fried onions, ghee
Mushroom biryani: basmati rice, mushroom | curd, fried onions
Chicken biryani: basmati rice, chicken | curd, fried onions, ghee
Mutton biryani: basmati rice, mutton | curd, fried onions, ghee
Egg biryani: basmati rice, egg | curd, fried onions, ghee
Fish biryani: basmati rice, fish | curd, fried onions
Prawn biryani: basmati rice, prawns | fried onions
Kolkata biryani: basmati rice, chicken, mutton | potato, egg, curd, fried onions, ghee
Malabar biryani: rice, chicken | ghee, cashews, fried onions, raisins
Ambur biryani: rice, chicken, mutton | curd, onion

## Khichdi
Moong dal khichdi: rice, moong dal | ghee
Masala khichdi: rice, moong dal, mixed vegetables | potato, onion, ghee
Vegetable khichdi: rice, moong dal, mixed vegetables | potato, carrot, ghee
Gujarati khichdi: rice, toor dal | ghee
Bhuna khichuri: rice, moong dal | potato, cauliflower, ghee
Bajra khichdi: bajra, moong dal | ghee
Dalia khichdi: broken wheat, moong dal | ghee
Ven pongal: rice, moong dal, ghee | cashews, pepper
Rava pongal: sooji, moong dal, ghee | cashews
Millet pongal: millet, moong dal, ghee | cashews
Oats pongal: oats, moong dal | ghee, cashews
Godhumai rava pongal: broken wheat, moong dal, ghee | cashews

## Flavoured rice
Lemon rice: rice, lemon | peanuts
Tamarind rice: rice, tamarind | peanuts, jaggery
Coconut rice: rice, coconut | cashews
Tomato rice: rice, tomato | onion, garlic
Bisi bele bath: rice, toor dal, mixed vegetables | ghee, cashews, potato
Vangi bath: rice, brinjal | cashews
Mango rice: rice, raw mango | peanuts
Sesame rice: rice, sesame
Pudina rice: rice, mint | onion
Capsicum rice: rice, capsicum
Pakhala: rice | curd

## Fried rice
Veg fried rice: rice, mixed vegetables | soy sauce, spring onion, garlic, carrot
Schezwan fried rice: rice, mixed vegetables, red chilli | soy sauce, garlic, spring onion
Paneer fried rice: rice, paneer | soy sauce, garlic, spring onion
Egg fried rice: rice, egg | soy sauce, garlic, spring onion
Chicken fried rice: rice, chicken | soy sauce, garlic, egg

## Noodles
Hakka noodles: noodles, cabbage, capsicum | soy sauce, garlic, spring onion, carrot
Schezwan noodles: noodles, red chilli | soy sauce, garlic, cabbage
Chilli garlic noodles: noodles, garlic, red chilli | soy sauce
Maggi: noodles | onion
Vegetable maggi: noodles, mixed vegetables | onion, carrot
Egg noodles: noodles, egg | soy sauce, garlic
Chicken noodles: noodles, chicken | soy sauce, garlic

## Pasta
White sauce pasta: pasta, milk, butter, maida | cheese, garlic
Red sauce pasta: pasta, tomato | garlic, onion
Pink sauce pasta: pasta, tomato, milk | cream, garlic, cheese
Masala pasta: pasta, tomato | onion, garlic, capsicum
Macaroni: macaroni, tomato | onion, garlic
Mac and cheese: macaroni, cheese, milk, butter
Pesto pasta: pasta, basil, cheese, cashews | garlic
Chicken pasta: pasta, chicken | cream, cheese, garlic

## Manchurian
Veg manchurian: cabbage, maida | carrot, soy sauce, garlic, onion
Gobi manchurian: cauliflower, maida | soy sauce, garlic, onion
Chilli paneer: paneer, capsicum | soy sauce, garlic, onion, maida
Chilli mushroom: mushroom, capsicum | soy sauce, garlic, onion
Chilli potato: potato | soy sauce, garlic, honey
Chilli baby corn: baby corn, capsicum | soy sauce, garlic, onion
Chilli chicken: chicken, capsicum | soy sauce, garlic, onion, egg, maida

## Soup
Tomato soup: tomato | butter, cream, garlic, onion
Sweet corn soup: sweet corn | spring onion
Hot and sour soup: mixed vegetables | soy sauce, garlic, spring onion
Manchow soup: mixed vegetables | soy sauce, garlic, noodles
Mixed vegetable soup: mixed vegetables | carrot, onion, garlic
Palak soup: spinach | cream, garlic, onion
Chicken soup: chicken | onion, garlic

## Chicken
Chicken curry: chicken, tomato | onion, garlic
Butter chicken: chicken, tomato, butter, cream | cashews, sugar, garlic
Chicken korma: chicken, curd, cashews | onion, garlic
Kadai chicken: chicken, capsicum, tomato | onion, garlic
Chicken do pyaza: chicken, onion | garlic
Chicken saagwala: chicken, spinach | onion, garlic
Chettinad chicken: chicken, coconut | shallots, garlic
Nadan chicken curry: chicken, coconut milk | shallots, garlic
Chicken stew: chicken, coconut milk | potato, carrot, onion
Andhra chicken curry: chicken | onion, garlic
Kolhapuri chicken: chicken, dry coconut | onion, garlic
Chicken xacuti: chicken, coconut | onion, garlic
Murgir jhol: chicken | potato, onion, garlic
Kosha murgi: chicken, curd | onion, garlic
Chicken keema: chicken | onion, garlic, green peas
Chicken fry: chicken | onion, garlic
Chicken 65: chicken | curd, egg, garlic, rice flour
Pepper chicken: chicken, pepper | onion, garlic
Chicken sukka: chicken, coconut | onion, garlic
Chicken ghee roast: chicken, ghee | garlic, curd
Kerala chicken roast: chicken | onion, garlic
Tandoori chicken: chicken, curd | garlic
Chicken tikka: chicken, curd | garlic, capsicum, onion

## Mutton
Mutton curry: mutton, tomato | onion, garlic
Mutton korma: mutton, curd, cashews | onion, garlic, almonds
Rogan josh: mutton, curd | onion, garlic
Mutton yakhni: mutton, curd
Laal maas: mutton, red chilli, curd | garlic, onion
Kosha mangsho: mutton, curd | onion, garlic, potato
Mangshor jhol: mutton | potato, onion, garlic
Mutton sukka: mutton, coconut | onion, garlic
Kerala mutton roast: mutton | onion, garlic
Mutton stew: mutton, coconut milk | potato, carrot, onion
Tambda rassa: mutton, dry coconut | onion, garlic
Dalcha: mutton, chana dal, tamarind | onion, garlic
Dhansak: mutton, toor dal, mixed vegetables | brinjal, pumpkin, onion, garlic, jaggery
Salli boti: mutton, tomato, jaggery | onion, garlic, potato
Keema matar: mutton keema, green peas | onion, garlic
Keema aloo: mutton keema, potato | onion, garlic
Keema pav: mutton keema, pav | onion, garlic, butter

## Pork
Pork curry: pork | onion, garlic
Pork vindaloo: pork, garlic, vinegar | onion, sugar
Sorpotel: pork | onion, garlic
Pandi curry: pork | onion, garlic
Smoked pork with bamboo shoot: pork, bamboo shoot | garlic
Pork with akhuni: pork, akhuni | garlic, tomato

## Fish & seafood
Fish masala curry: fish, tomato | onion, garlic
Macher jhol: fish, tomato | potato, onion
Shorshe maach: hilsa, mustard paste
Doi maach: rohu, curd | onion, garlic, sugar
Meen kuzhambu: fish, tamarind | shallots, garlic
Kerala fish curry: fish, kokum | coconut, shallots, garlic
Fish moilee: fish, coconut milk | onion, garlic
Goan fish curry: fish, coconut | onion, garlic
Ambot tik: fish, tamarind | onion, garlic
Malvani fish curry: fish, coconut | onion, garlic
Fish gassi: fish, coconut | onion, garlic
Chepala pulusu: fish, tamarind | onion, garlic
Masor tenga: fish, tomato | lemon
Machha besara: fish, mustard paste | garlic
Masala fish fry: fish | garlic, onion
Rava fish fry: fish, sooji
Meen varuval: fish | garlic, shallots
Maach bhaja: fish
Amritsari fish: fish, besan | egg, garlic
Bombil fry: bombil, rice flour, sooji
Pomfret fry: pomfret, sooji | garlic
Prawn curry: prawns, coconut | onion, garlic
Prawn masala: prawns, tomato | onion, garlic
Prawn fry: prawns | garlic, onion
Chingri malai curry: prawns, coconut milk | onion, garlic
Prawn balchao: prawns, red chilli | garlic, onion, sugar
Prawn ghee roast: prawns, ghee | garlic
Royyala iguru: prawns | onion, garlic

## Raita
Boondi raita: curd, boondi
Cucumber raita: curd, cucumber
Onion raita: curd, onion
Mixed vegetable raita: curd, cucumber, tomato | onion
Mint raita: curd, mint
Pineapple raita: curd, pineapple | sugar
Aloo raita: curd, potato
Lauki raita: curd, lauki
Beetroot raita: curd, beetroot
Vellarikka pachadi: curd, cucumber, coconut

## Salad
Kachumber: cucumber, tomato | onion, lemon
Green salad: cucumber, tomato | onion, carrot
Koshimbir: cucumber, curd | peanuts
Kosambari: moong dal, cucumber | coconut
Sprouts salad: sprouts | onion, tomato
Carrot salad: carrot
Beetroot salad: beetroot
Corn salad: sweet corn
Cucumber salad: cucumber
Laccha onion: onion
Fruit chaat: fruit
Chana salad: chickpeas | onion, tomato

## Chutney
Coconut chutney: coconut | curry leaves
Tomato chutney: tomato | onion, garlic
Onion tomato chutney: onion, tomato | garlic
Onion chutney: onion | garlic
Mint chutney: mint, coriander | onion, garlic
Coriander chutney: coriander | lemon
Peanut chutney: peanuts | garlic
Tamarind chutney: tamarind, jaggery | dates
Gongura chutney: gongura | garlic, onion
Beerakaya pachadi: turai | garlic, onion
Dry garlic chutney: garlic, dry coconut | peanuts
Thecha: green chilli, garlic | peanuts
Shenga chutney pudi: peanuts | garlic
Idli podi: urad dal, chana dal | sesame
Chammanthi: coconut | shallots
Tomato khejur chutney: tomato, dates, sugar

## Pickle
Mango pickle: raw mango
Avakaya: raw mango | garlic
Lime pickle: lime
Mixed pickle: raw mango, lime | carrot, cauliflower
Garlic pickle: garlic
Green chilli pickle: green chilli
Gongura pickle: gongura | garlic
Amla pickle: amla
Carrot pickle: carrot
Sweet mango pickle: raw mango, sugar

## Papad
Roasted papad: urad papad
Fried papad: urad papad
Masala papad: urad papad | onion, tomato
Appalam: urad papad
Pappadam: urad papad
Sabudana papad: sabudana
Rice papad: rice flour

## Buttermilk
Chaas: buttermilk
Masala chaas: buttermilk | mint, coriander
Neer mor: buttermilk | curry leaves
Sweet lassi: curd, sugar
Salted lassi: curd
Sol kadhi: coconut milk, kokum | garlic

## Fruit
Seasonal fruit: seasonal fruit
Banana: banana
Apple slices: apple
Papaya: papaya
Fruit custard: milk, fruit, sugar

## Roll
Paneer roll: atta, paneer | onion, capsicum
Veg frankie: maida, potato, mixed vegetables | onion
Aloo roll: atta, potato
Chapati roll: atta, mixed vegetables
Egg roll: maida, egg | onion
Chicken kathi roll: maida, chicken | onion

## Namkeen
Poha chivda: poha | peanuts, cashews, sugar
Cornflakes chivda: cornflakes | peanuts, cashews, sugar
Murmura chivda: puffed rice | peanuts
Mixture: besan, sev | peanuts
Khakhra: khakhra
Mathri: maida
Chakli: rice flour | butter
Banana chips: raw banana
Shankarpali: maida, sugar, ghee
Bhakarwadi: besan, maida | sugar, sesame
Masala peanuts: peanuts, besan
Roasted chana: kala chana
Roasted makhana: makhana | ghee
Masala makhana: makhana | ghee

## Cutlet
Veg cutlet: potato, mixed vegetables | breadcrumbs, carrot
Aloo tikki: potato | green peas
Poha cutlet: poha, potato
Beetroot cutlet: beetroot, potato | breadcrumbs
Paneer cutlet: paneer, potato | breadcrumbs
Fish cutlet: fish, potato | breadcrumbs, egg
Chicken cutlet: chicken, potato | breadcrumbs, egg

## Pakora
Onion pakora: onion, besan
Aloo pakora: potato, besan
Palak pakora: spinach, besan
Paneer pakora: paneer, besan
Gobi pakora: cauliflower, besan
Mirchi bajji: green chilli, besan
Moong dal pakoda: moong dal | onion
Bread pakora: bread, besan | potato
Aloo bonda: potato, besan
Mysore bonda: maida, curd
Punugulu: idli rice, urad dal | onion
Goli baje: maida, curd

## Samosa
Aloo samosa: maida, potato | green peas
Onion samosa: maida, onion
Patti samosa: maida, onion
Shingara: maida, potato | peanuts, cauliflower
Keema samosa: maida, mutton keema | onion

## Vada
Medu vada: urad dal | onion, curry leaves
Masala vada: chana dal | onion
Sambar vada: urad dal, toor dal | shallots
Batata vada: potato, besan | garlic
Maddur vada: sooji, rice flour, onion
Rava vada: sooji | onion
Sabudana vada: sabudana, potato | peanuts

## Chaat
Bhel puri: puffed rice, sev | onion, sweet chutney, potato
Sev puri: papdi, potato | onion, sweet chutney, sev
Pani puri: puri shells, potato | chickpeas, sweet chutney
Dahi puri: puri shells, curd, potato | sweet chutney, sev
Papdi chaat: papdi, curd, potato | sweet chutney
Raj kachori: maida, curd, potato | sweet chutney, sev
Aloo tikki chaat: potato, curd | sweet chutney, onion
Dahi vada: urad dal, curd | sweet chutney
Ragda pattice: white peas, potato | onion, sweet chutney
Jhal muri: puffed rice | onion, peanuts, mustard oil
Chana chaat: chickpeas | onion, tomato
Masala corn: sweet corn | butter, lemon
Sweet potato chaat: sweet potato | lemon

## Sundal
Chana sundal: kala chana | coconut
Peanut sundal: peanuts | coconut
Karamani sundal: lobia | coconut
Pattani sundal: white peas | coconut
Pachai payaru sundal: whole moong | coconut

## Kheer
Rice kheer: rice, milk, sugar | cashews, almonds, raisins
Semiya payasam: vermicelli, milk, sugar | cashews, raisins, ghee
Sabudana kheer: sabudana, milk, sugar | cashews
Makhana kheer: makhana, milk, sugar | almonds
Lauki kheer: lauki, milk, sugar | almonds
Phirni: rice, milk, sugar | almonds, pistachios
Ada pradhaman: rice flour, coconut milk, jaggery | cashews, ghee
Parippu payasam: moong dal, coconut milk, jaggery | cashews, ghee
Sakkarai pongal: rice, moong dal, jaggery, ghee | cashews

## Halwa
Suji halwa: sooji, ghee, sugar | cashews, raisins
Rava kesari: sooji, ghee, sugar | cashews
Pineapple kesari: sooji, ghee, sugar, pineapple | cashews
Banana sheera: sooji, ghee, sugar, banana | cashews, milk
Aate ka halwa: atta, ghee, sugar | almonds
Gajar halwa: carrot, milk, sugar, ghee | almonds, cashews
Moong dal halwa: moong dal, ghee, sugar | almonds
Lauki halwa: lauki, milk, sugar | ghee, almonds

## Ladoo
Besan ladoo: besan, ghee, sugar | almonds, cashews
Rava ladoo: sooji, ghee, sugar | coconut, cashews
Coconut ladoo: coconut, sugar | condensed milk, ghee
Til ladoo: sesame, jaggery | peanuts
Dry fruit ladoo: dry fruits, dates
Atta ladoo: atta, ghee, jaggery | almonds
Gond ladoo: atta, gond, ghee, sugar | almonds
Ragi ladoo: ragi flour, ghee, jaggery | cashews
Peanut ladoo: peanuts, jaggery
`;

// NUTRITION (4.2.0): what a dish is rich in, for a person's food goals (people.targets: more protein, fewer carbs, less fat).
// A dish is rich in one when a MAIN ingredient is listed for it here, or when its kind is (a dal is protein, a puri is fried).
// A preference only: the plan leans towards a dish that fits, never past a food rule.
const NUTRITION = {
  protein: {
    ingredients: "toor dal; moong dal; masoor dal; urad dal; chana dal; whole moong; rajma; chickpeas; kala chana; lobia; white peas; horse gram; matki; sprouts; besan; sattu; soya chunks; paneer; cheese; egg; chicken; mutton; mutton keema; pork; fish; prawns; dry fish; hilsa; rohu; pomfret; bombil",
    kinds: "Dal; Egg; Chilla; Sundal; Chicken; Mutton; Pork; Fish & seafood",
  },
  carbs: {
    ingredients: "rice; idli rice; basmati rice; raw rice; matta rice; poha; rice flour; puffed rice; rice rava; maida; sooji; bread; pav; vermicelli; noodles; pasta; macaroni; potato; sweet potato; sabudana; tapioca; corn; sweet corn; cornflakes; sugar; jaggery; condensed milk",
    kinds: "Pulao; Biryani; Flavoured rice; Fried rice; Noodles; Pasta; Puri; Kheer; Halwa; Ladoo",
  },
  fat: {
    ingredients: "ghee; butter; cream; khoa; cheese; condensed milk; cashews; almonds; coconut; coconut milk; dry coconut; peanuts; peanut butter; fried onions; sev; boondi",
    kinds: "Puri; Kachori; Pakora; Samosa; Vada; Cutlet; Halwa; Ladoo",
  },
};

module.exports = { INGREDIENT_TAGS, PLAIN, ITEMS, NUTRITION };
