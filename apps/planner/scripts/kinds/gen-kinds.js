// Generator for apps/planner/server/kinds.json and docs/kinds-catalog.md.
// Item notation: "Name | aka; aka | tag-abbrevs | cuisines"
const T = { e: "egg", m: "meat", f: "fish", ch: "chicken", mt: "mutton", pk: "pork", bf: "beef", pr: "prawn", og: "onion_garlic", d: "dairy", n: "nuts", p: "peanut", s: "sugar",
  r: "white_rice", w: "wheat", rv: "root_veg", mu: "mushroom", b: "brinjal", k: "karela", c: "coconut", so: "soy" };
// "m" and "f" in item strings are resolved per item to chicken/mutton/pork and fish/prawn (see resolveTag).
const TAGS = Object.values(T).filter((t) => t !== "meat");
const PARENTS = { chicken: "meat", mutton: "meat", pork: "meat", beef: "meat", fish: "seafood", prawn: "seafood" };
const CUISINES = ["north","south","tamil","kerala","karnataka","andhra","west","maharashtra","gujarat","goa","rajasthan","east","bengal","odisha","assam","northeast","central","kashmir","punjab","sindhi","parsi","indo_chinese","continental"];
const MEALS = ["breakfast","lunch","dinner","tiffin","snack"];
const PARTS = ["staple","main","side","complete","sweet","snack","drink"];
const ALL = "north south west east";
const kinds = [];
function K(group, name, aka, cuisines, meals, staple, part, diet, items) {
  kinds.push({ group, name, aka, cuisines, meals, staple, part, diet, items });
}
const sp = (s) => (s || "").split(/\s+/).filter(Boolean);
const semi = (s) => (s || "").split(";").map((x) => x.trim()).filter(Boolean);

// ---------------- BREAKFAST ----------------
K("B","Idli","idly; iddli; idlis","south","breakfast dinner tiffin",false,"complete","veg",[
 "Idli | idly | r",
 "Rava idli | sooji idli | w d n",
 "Kanchipuram idli | kanchipuram kudalai idli | r d n | tamil",
 "Mini idli | button idli; cocktail idli | r",
 "Ghee podi idli | podi idli | r d",
 "Ragi idli | | r",
 "Oats idli | | w d",
 "Thatte idli | | r | karnataka",
 "Sambar idli | sambar dip idli | r og",
]);
K("B","Dosa","dosai; dose; dosey","south","breakfast dinner tiffin",false,"complete","mixed",[
 "Plain dosa | sada dosa; dosai | r",
 "Masala dosa | | r rv og",
 "Mysore masala dosa | | r rv og | karnataka",
 "Ghee roast dosa | ghee roast; nei roast | r d",
 "Benne dosa | butter dosa; davangere benne dose | r d | karnataka",
 "Onion dosa | vengaya dosai | r og",
 "Rava dosa | rava dosai | r w og",
 "Set dosa | sponge dosa | r | karnataka",
 "Neer dosa | | r c | karnataka",
 "Ragi dosa | | r",
 "Wheat dosa | godhuma dosa; atta dosa | w og",
 "Kal dosai | kal dosa | r | tamil",
 "Egg dosa | muttai dosai | r e",
]);
K("B","Uttapam","uthappam; oothappam; uttappa","south","breakfast dinner tiffin",false,"complete","veg",[
 "Onion uttapam | vengaya uthappam | r og",
 "Tomato uttapam | | r og",
 "Mixed vegetable uttapam | veg uttapam | r og rv",
 "Plain uttapam | | r",
 "Rava uttapam | sooji uttapam | w d og",
 "Podi uttapam | | r",
]);
K("B","Pongal","ven pongal; khara pongal; huggi; pongali","south","breakfast",false,"complete","veg",[
 "Ven pongal | khara pongal; ghee pongal; huggi | r d n",
 "Rava pongal | | w d n",
 "Millet pongal | thinai pongal; varagu pongal; samai pongal | d n",
 "Oats pongal | | d n",
 "Godhumai rava pongal | broken wheat pongal; dalia pongal | w d n",
]);
K("B","Upma","uppittu; uppumavu; kharabath; upeet; uppuma; khara bath","north south west","breakfast dinner tiffin",false,"complete","veg",[
 "Rava upma | sooji upma; uppittu; upeet | w og n p",
 "Vegetable upma | khara bath | w og rv n",
 "Semiya upma | vermicelli upma; shevai upma | w og n",
 "Dalia upma | broken wheat upma; godhuma rava upma; vegetable dalia; namkeen dalia; masala dalia | w og",
 "Rice upma | arisi upma; akki tari uppittu | r og c",
 "Bread upma | | w og",
 "Oats upma | masala oats | og rv",
 "Idli upma | leftover idli upma | r og",
]);
K("B","Poha","pohe; aval; avalakki; chira; chire; chuda; atukulu; avil; flattened rice","north west south east central","breakfast tiffin snack",false,"complete","veg",[
 "Kanda poha | kande pohe; onion poha | r og p | maharashtra",
 "Batata poha | batata pohe; aloo poha | r og p rv | west",
 "Indori poha | | r og p s | central",
 "Dadpe pohe | | r og c | maharashtra",
 "Matar poha | peas poha | r og p",
 "Vegetable poha | | r og p rv",
 "Aval upma | poha upma; aval kichadi | r og p | tamil",
 "Avalakki oggarane | avalakki | r og p | karnataka",
 "Aval nanachathu | | r c s | kerala",
 "Chire bhaja | chira bhaja | r og p | bengal",
 "Doi chire | dahi chura | r d s | east",
]);
K("B","Paratha","parantha; parotha; prantha; porota","north punjab west","breakfast lunch dinner tiffin",false,"complete","mixed",[
 "Aloo paratha | | w rv d",
 "Gobi paratha | | w d",
 "Methi paratha | | w d",
 "Paneer paratha | | w d",
 "Mooli paratha | | w d",
 "Palak paratha | | w d",
 "Pyaaz paratha | onion paratha | w og d",
 "Mixed vegetable paratha | veg paratha | w d rv",
 "Dal paratha | | w d",
 "Lachha paratha | plain paratha; tikona paratha | w d",
 "Matar paratha | peas paratha | w d",
 "Sattu paratha | | w og d | east",
 "Sindhi koki | koki | w og d | sindhi",
 "Egg paratha | anda paratha | w e d",
 "Keema paratha | | w m og d",
]);
K("B","Thepla","theplu; methi na thepla","gujarat","breakfast tiffin dinner snack",false,"complete","veg",[
 "Methi thepla | methi na thepla | w d",
 "Plain thepla | masala thepla | w d",
 "Dudhi thepla | lauki thepla | w d",
 "Palak thepla | | w d",
 "Bajra methi thepla | | w d",
 "Mooli thepla | | w d",
]);
K("B","Thalipeeth","thalipith; thalipeet","maharashtra","breakfast snack",false,"complete","veg",[
 "Bhajani thalipeeth | | w r og",
 "Jowar thalipeeth | | og",
 "Methi thalipeeth | | w r og",
 "Kakdi thalipeeth | cucumber thalipeeth | r og",
]);
K("B","Chilla","cheela; chila; pudla; puda; poodla","north west central","breakfast tiffin dinner",false,"complete","veg",[
 "Besan chilla | besan cheela; pudla | og",
 "Moong dal chilla | moong dal cheela | og",
 "Paneer chilla | stuffed paneer chilla | d og",
 "Rava chilla | sooji chilla | w d og",
 "Oats chilla | | og",
 "Vegetable chilla | | og rv",
]);
K("B","Pesarattu","pesara dosa; moong dal dosa; green gram dosa","andhra","breakfast dinner",false,"complete","veg",[
 "Pesarattu | pesara dosa | r og",
 "Upma pesarattu | MLA pesarattu | r og w",
]);
K("B","Adai","adai dosai; adai dosa","tamil kerala","breakfast dinner",false,"complete","veg",[
 "Adai | adai dosai | r og",
 "Vegetable adai | | r og rv",
 "Murungai keerai adai | drumstick leaf adai | r og",
]);
K("B","Appam","aappam; hoppers; palappam; vellayappam","kerala tamil","breakfast dinner",false,"main","veg",[
 "Appam | palappam; vellayappam | r c s",
 "Kallappam | | r c s",
 "Rava appam | instant appam | w c s",
]);
K("B","Puttu","pittu; puttu kadala","kerala","breakfast dinner",false,"main","veg",[
 "Rice puttu | puttu; arisi puttu | r c",
 "Wheat puttu | gothambu puttu | w c",
 "Ragi puttu | | c",
 "Corn puttu | cholam puttu; maize puttu | c",
]);
K("B","Idiyappam","string hoppers; nool puttu; sevai; noolappam; shavige; ottu shavige","kerala tamil karnataka","breakfast dinner tiffin",false,"main","veg",[
 "Idiyappam | rice idiyappam; string hoppers; nool puttu; noolappam | r",
 "Ragi idiyappam | ragi shavige | r",
 "Wheat idiyappam | gothambu idiyappam | w",
 "Lemon sevai | elumichai sevai; lemon shavige | r p",
 "Coconut sevai | thengai sevai | r c",
]);
K("B","Kozhukattai","kolukattai; modak; kadubu; undrallu","south maharashtra","breakfast snack",false,"snack","veg",[
 "Pidi kozhukattai | | r c",
 "Ammini kozhukattai | | r c",
 "Ulundu kozhukattai | uppu kozhukattai | r c",
 "Sweet kozhukattai | modak; ukadiche modak; modakam; kadubu | r c s d",
]);
K("B","Akki roti","akki rotti; rotti; rice roti","karnataka","breakfast dinner",false,"complete","veg",[
 "Akki roti | akki rotti | r og c",
 "Ragi roti | ragi rotti | og",
 "Sabsige akki roti | dill akki roti | r og c",
 "Pathiri | ari pathiri | r | kerala",
]);
K("B","Paniyaram","kuzhi paniyaram; paddu; gunta ponganalu; appe; guliyappa","south maharashtra","breakfast snack tiffin",false,"complete","veg",[
 "Kara paniyaram | kuzhi paniyaram; paddu; gunta ponganalu | r og",
 "Sweet paniyaram | inippu paniyaram | r s",
 "Rava appe | | w d og",
 "Ragi paniyaram | | r og",
]);
K("B","Puri","poori; luchi; bhatura; pakwan","north west east south","breakfast lunch dinner tiffin",false,"staple","veg",[
 "Puri | poori | w",
 "Masala puri | ajwain puri | w",
 "Palak puri | | w",
 "Luchi | | w | bengal",
 "Radhaballabhi | | w | bengal",
 "Bedmi puri | | w | north",
 "Bhatura | bhature | w d",
 "Pakwan | | w | sindhi",
 "Mangalore buns | banana puri | w s d | karnataka",
]);
K("B","Kachori","kochuri; kachauri","north rajasthan east","breakfast snack",false,"snack","veg",[
 "Khasta kachori | dal kachori | w",
 "Pyaaz kachori | onion kachori | w og | rajasthan",
 "Matar kachori | koraishutir kochuri | w",
 "Hing kochuri | | w | bengal",
 "Aloo kachori | | w rv",
]);

K("B","Porridge","oats; oatmeal; dalia; daliya; ragi malt; kanji","north west south continental","breakfast",false,"complete","veg",[
 "Oats porridge | oatmeal | d s | continental",
 "Overnight oats | | d s n | continental",
 "Sweet milk dalia | meetha dalia; dalia porridge | w d s n | north west",
 "Ragi malt | ragi porridge; ragi java; ragi kanji | d s | south",
 "Lapsi | fada ni lapsi | w d s n | gujarat",
]);
K("B","Cereal","cornflakes; muesli; chocos","continental","breakfast",false,"complete","veg",[
 "Cornflakes with milk | cornflakes | d s",
 "Muesli | | d n s w",
 "Chocos | | w d s",
 "Wheat flakes | | w d s",
]);
K("B","Toast","bread toast; bread butter","continental","breakfast tiffin snack",false,"complete","mixed",[
 "Bread butter toast | butter toast | w d",
 "Bread jam | jam toast | w s",
 "French toast | | w e d s",
 "Masala toast | | w d og rv",
 "Peanut butter toast | | w p s",
 "Cheese toast | chilli cheese toast | w d",
]);
K("B","Sandwich","sandwiches","continental west","breakfast tiffin snack",false,"complete","mixed",[
 "Vegetable sandwich | veg sandwich | w d",
 "Bombay sandwich | | w d rv | maharashtra",
 "Grilled cheese sandwich | cheese sandwich | w d",
 "Paneer sandwich | | w d",
 "Aloo sandwich | potato sandwich | w rv d",
 "Corn sandwich | corn cheese sandwich | w d",
 "Chutney sandwich | | w d",
 "Egg sandwich | egg mayo sandwich | w e d",
 "Chicken sandwich | | w m e d",
]);
K("B","Eggs","anda; muttai; egg","north south west east","breakfast dinner tiffin",false,"main","egg",[
 "Masala omelette | omelette; anda omelette | e og",
 "Plain omelette | | e",
 "Egg bhurji | anda bhurji | e og",
 "Boiled eggs | | e",
 "Half fry | fried egg; bull's eye | e",
 "Bread omelette | | e w og",
 "Akuri | | e og d | parsi",
 "Egg podimas | muttai podimas | e og | tamil",
 "Scrambled eggs | | e d | continental",
]);
K("B","Dhokla","khaman; farsan; muthia; muthiya","gujarat","breakfast snack tiffin",false,"snack","veg",[
 "Khaman dhokla | khaman | s",
 "Khatta dhokla | idada | r d",
 "Rava dhokla | sooji dhokla | w d",
 "Moong dal dhokla | |",
 "Sandwich dhokla | | r d",
 "Khandvi | | d c",
 "Methi muthia | muthia; muthiya | w d s",
 "Dudhi muthia | lauki muthia | w d s",
]);
K("B","Handvo","handwa","gujarat","breakfast dinner snack",false,"complete","veg",[
 "Handvo | mixed dal handvo | r d s",
 "Rava handvo | sooji handvo | w d",
 "Vegetable handvo | | r d rv s",
]);
K("B","Sabudana","sago; javvarisi; saggubiyyam; upvas","maharashtra gujarat north","breakfast snack",false,"complete","veg",[
 "Sabudana khichdi | | p rv",
 "Sabudana vada | | p rv",
 "Sabudana thalipeeth | upvas thalipeeth | p rv",
 "Javvarisi upma | sago upma | og | tamil",
]);
K("B","Misal","misal pav; usal pav","maharashtra","breakfast snack",false,"complete","veg",[
 "Misal pav | | w og",
 "Puneri misal | | w og r s",
 "Kolhapuri misal | | w og c",
 "Usal pav | | w og",
]);
K("B","Pitha","pithe; pitta","east bengal odisha assam","breakfast snack",false,"snack","veg",[
 "Patishapta | | r w c s d | bengal",
 "Puli pitha | | r c s | bengal",
 "Bhapa pitha | | r c s",
 "Chitoi pitha | chitol pitha | r | bengal",
 "Til pitha | | r s | assam",
 "Enduri pitha | | r c s | odisha",
 "Chakuli pitha | | r | odisha",
 "Poda pitha | | r c s | odisha",
]);
K("B","Pav bhaji","bhaji pav; pav","maharashtra gujarat","dinner snack",false,"complete","veg",[
 "Pav bhaji | | w d rv og",
 "Jain pav bhaji | | w d",
 "Masala pav | | w d og",
 "Dabeli | kutchi dabeli | w rv p s | gujarat",
]);

// ---------------- STAPLES ----------------
K("S","Roti","chapati; phulka; fulka; rotli; poli; chapathi; chapatti","north south west east central","lunch dinner tiffin",true,"staple","veg",[
 "Phulka | fulka | w",
 "Chapati | chapathi; rotli; poli; tawa roti | w",
 "Ghee roti | ghee chapati; tup poli | w d",
 "Missi roti | | w og",
 "Makki ki roti | makki di roti; makai roti | | punjab",
 "Multigrain roti | multigrain chapati | w",
]);
K("S","Bhakri","bhakar; rotla; rotlo; jolada rotti; jowar roti; bajra roti; millet roti","maharashtra gujarat rajasthan karnataka","lunch dinner",true,"staple","veg",[
 "Jowar bhakri | jowar roti; jolada rotti | | ",
 "Bajra bhakri | bajra roti; bajra no rotlo; bajre ki roti |",
 "Nachni bhakri | ragi bhakri; ragi roti (flat) |",
 "Rice bhakri | tandlachi bhakri; akki bhakri | r | maharashtra goa",
 "Wheat bhakri | ghau ni bhakri | w | gujarat",
]);
K("S","Rice","chawal; bhaat; bhat; sadam; annam; anna; plain rice","north south west east","lunch dinner",true,"staple","veg",[
 "Steamed rice | plain rice; chawal; bhaat; sadam; annam | r",
 "Jeera rice | | r d",
 "Brown rice | |",
 "Matta rice | kerala red rice; rosematta; red rice | | kerala",
]);
K("S","Curd","dahi; thayir; mosaru; perugu; doi; yogurt","north south west east","lunch dinner",true,"side","veg",[
 "Curd | dahi; thayir; mosaru; perugu; doi | d",
]);
K("S","Mudde","ragi mudde; ragi sangati; ragi ball; sankati","karnataka andhra","lunch dinner",true,"staple","veg",[
 "Ragi mudde | ragi ball; ragi kali | ",
 "Ragi sangati | sankati | r | andhra",
]);

// ---------------- DALS & GRAVIES ----------------
K("D","Dal","daal; pappu; paruppu; amti; varan; dali; dalma; tovve; bele; parippu; lentils","north south west east central","lunch dinner",false,"main","veg",[
 "Moong dal | yellow moong dal; dhuli moong | og",
 "Masoor dal | red lentil dal | og",
 "Toor dal | arhar dal; tuvar dal | og",
 "Chana dal | chane ki dal | og",
 "Urad dal | dhuli urad dal | og",
 "Mixed dal | panchratna dal | og",
 "Panchmel dal | | d og | rajasthan",
 "Dal tadka | yellow dal tadka | d og",
 "Dal fry | | og",
 "Dal makhani | | d og | punjab",
 "Palak dal | dal palak | og",
 "Lauki chana dal | | og",
 "Khatti dal | | og | andhra",
 "Gujarati dal | gujarati toor dal; khatti meethi dal | s p | gujarat",
 "Varan | varan bhaat dal | | maharashtra",
 "Amti | katachi amti; toor dal amti | s c | maharashtra",
 "Muddha pappu | plain pappu | | andhra",
 "Tomato pappu | | og | andhra",
 "Palakura pappu | spinach pappu | og | andhra",
 "Mamidikaya pappu | mango dal | og | andhra",
 "Dosakaya pappu | | og | andhra",
 "Paruppu | paruppu kadayal | | tamil",
 "Kerala parippu curry | parippu | c | kerala",
 "Tovve | | | karnataka",
 "Cholar dal | | c s d | bengal",
 "Bengali masoor dal | musur dal | og | bengal",
 "Sona moong dal | bhaja moong dal | d | bengal",
 "Dalma | | rv b c | odisha",
 "Sai bhaji | sindhi sai bhaji | og rv b | sindhi",
]);
K("D","Sambar","sambhar; huli; kuzhambu sambar","south","breakfast lunch dinner",false,"main","veg",[
 "Drumstick sambar | murungakkai sambar | og",
 "Mixed vegetable sambar | | og rv",
 "Onion sambar | vengaya sambar; small onion sambar | og",
 "Radish sambar | mullangi sambar | og rv",
 "Brinjal sambar | kathirikai sambar | og b",
 "Pumpkin sambar | parangikai sambar | og",
 "Okra sambar | vendakkai sambar | og",
 "Tiffin sambar | idli sambar | og",
 "Arachuvitta sambar | | c | tamil",
 "Udupi sambar | huli | c s | karnataka",
 "Kerala sambar | | c og | kerala",
]);
K("D","Rasam","saaru; charu; chaaru","south","lunch dinner",false,"side","veg",[
 "Tomato rasam | thakkali rasam; tomato charu | og",
 "Pepper rasam | milagu rasam | og",
 "Lemon rasam | elumichai rasam |",
 "Garlic rasam | poondu rasam | og",
 "Mysore rasam | | c | karnataka",
 "Paruppu rasam | dal rasam |",
 "Pineapple rasam | | s",
 "Jeera rasam | jeeragam rasam |",
 "Udupi saaru | udupi rasam | s | karnataka",
 "Kollu rasam | horsegram rasam | og",
]);
K("D","Kadhi","kadi; mor kuzhambu; majjige huli; pulissery; moru curry","north west south sindhi","lunch dinner",false,"main","veg",[
 "Punjabi kadhi pakora | kadhi pakoda | d og | punjab",
 "Gujarati kadhi | | d s | gujarat",
 "Rajasthani kadhi | | d | rajasthan",
 "Maharashtrian kadhi | taak kadhi | d | maharashtra",
 "Sindhi kadhi | | rv | sindhi",
 "Mor kuzhambu | | d c | tamil",
 "Majjige huli | | d c | karnataka",
 "Pulissery | moru curry | d c | kerala",
]);
K("D","Kuzhambu","kulambu; kozhambu; pulusu; gojju; puli kuzhambu","tamil andhra karnataka","lunch dinner",false,"main","veg",[
 "Vatha kuzhambu | vathal kuzhambu | og | tamil",
 "Kara kuzhambu | | og | tamil",
 "Poondu kuzhambu | garlic kuzhambu | og | tamil",
 "Ennai kathirikai kuzhambu | | b og | tamil",
 "Paruppu urundai kuzhambu | | og | tamil",
 "Puli kuzhambu | tamarind kuzhambu | og | tamil",
 "Sorakaya pulusu | | og | andhra",
 "Bendakaya pulusu | okra pulusu | og | andhra",
 "Mukkala pulusu | | og rv b | andhra",
 "Pineapple gojju | | s | karnataka",
 "Hagalakai gojju | bitter gourd gojju | k s | karnataka",
]);
K("D","Kootu","koottu; kootan","tamil kerala","lunch dinner",false,"side","veg",[
 "Chow chow kootu | | c",
 "Poricha kootu | | c",
 "Keerai kootu | spinach kootu | c",
 "Pudalangai kootu | snake gourd kootu | c",
 "Kathirikai kootu | brinjal kootu | c b",
 "Cabbage kootu | | c",
]);
K("D","Pithla","pitla; zunka; jhunka","maharashtra","lunch dinner",false,"main","veg",[
 "Pithla | pitla | og",
 "Zunka | jhunka | og",
]);
K("D","Legume curry","rajma; chole; chhole; chana; usal; kadala curry; lobia; ghugni; rassa; kabuli chana","north south west east","breakfast lunch dinner",false,"main","veg",[
 "Rajma | rajma masala; rajma chawal | og",
 "Jammu rajma | chitra rajma | og | kashmir",
 "Chole | chana masala; chhole; kabuli chana | og",
 "Pindi chole | | og | punjab",
 "Kala chana curry | kale chane | og",
 "Lobia | lobia masala; chawli | og",
 "Safed matar | ragda; white peas curry | og",
 "Ghugni | | og | east",
 "Matki usal | | og c | maharashtra",
 "Moong usal | | og c | maharashtra",
 "Vatana usal | | og c | maharashtra",
 "Kadala curry | | og c | kerala",
 "Chana ghassi | | c | karnataka",
 "Sprouts curry | moong sprouts curry | og",
]);

// ---------------- VEGETABLES ----------------
K("V","Sabzi","sabji; subzi; sukhi sabzi; dry sabzi; bhaji; poriyal; porial; thoran; torkari; palya; vepudu; upkari; shaak; fugath; sukke","north south west east central","lunch dinner tiffin",false,"main","veg",[
 "Bhindi sabzi | bhindi fry; bhindi masala; vendakkai poriyal | og",
 "Aloo gobi | | rv og",
 "Jeera aloo | aloo jeera | rv",
 "Aloo methi | | rv og",
 "Aloo bhaji | puri bhaji; batata bhaji; batatyachi bhaji | rv",
 "Lauki sabzi | doodhi sabzi; ghiya | ",
 "Tinda sabzi | | og",
 "Turai sabzi | tori; ridge gourd sabzi | og",
 "Parwal sabzi | potol | og",
 "Karela sabzi | karela fry | k og",
 "Cabbage sabzi | patta gobhi | og",
 "Beans sabzi | french beans sabzi | ",
 "Gajar matar | | rv",
 "Kaddu sabzi | khatta meetha kaddu; pumpkin sabzi | s",
 "Arbi sabzi | arbi fry; colocasia | rv",
 "Baingan aloo | aloo baingan | b rv og",
 "Aloo shimla mirch | capsicum aloo | rv",
 "Kundru sabzi | tondli; tindora; tindora nu shaak | og",
 "Mixed vegetable sabzi | mix veg sukhi | rv og",
 "Suran sabzi | yam sabzi | rv",
 "Ker sangri | | | rajasthan",
 "Haak | haak saag | | kashmir",
 "Bateta nu shaak | | rv s | gujarat",
 "Methi bhaji | methichi bhaji | og | maharashtra",
 "Beans poriyal | beans thoran; beans palya | c | south",
 "Cabbage thoran | cabbage poriyal | c | south",
 "Carrot poriyal | | rv c | south",
 "Beetroot poriyal | beetroot thoran | rv c | south",
 "Vazhakkai poriyal | raw banana fry; kachche kele ki sabzi | | south",
 "Urulaikizhangu roast | potato roast; aloo fry | rv | south",
 "Senai roast | yam fry; suran fry | rv | south",
 "Keerai poriyal | spinach poriyal; cheera thoran | c | south",
 "Kovakkai fry | | og | south",
 "Bendakaya vepudu | | og | andhra",
 "Dondakaya vepudu | | og p | andhra",
 "Shukto | | k b rv d s | bengal",
 "Chorchori | | rv b | bengal",
 "Lau ghonto | | d | bengal",
 "Mochar ghonto | | rv c | bengal",
 "Aloo posto | | rv | bengal",
 "Bandhakopir torkari | | rv | bengal",
]);
K("V","Gravy sabzi","rasedar sabzi; curry; tari wali sabzi; kurma; korma; rassa; dalna; shaak","north south west east","lunch dinner",false,"main","veg",[
 "Aloo matar | | rv og",
 "Aloo tamatar | aloo rasedar | rv",
 "Aloo palak | palak aloo | rv og",
 "Dum aloo | | rv d og",
 "Kashmiri dum aloo | | rv d | kashmir",
 "Matar mushroom | | mu og",
 "Mushroom masala | | mu og",
 "Mix veg curry | mixed vegetable curry | rv og",
 "Vegetable kurma | veg korma | rv c n og | south",
 "Baingan masala | | b og",
 "Methi matar malai | | d n og",
 "Kathal sabzi | jackfruit curry; echorer dalna | og rv",
 "Soya chunks curry | soya curry | so og",
 "Sarson da saag | sarson ka saag | d og | punjab",
 "Gatte ki sabzi | | d og | rajasthan",
 "Papad ki sabzi | | d | rajasthan",
 "Sev tameta | sev tameta nu shaak | og s | gujarat",
 "Undhiyu | | rv b c p s w | gujarat",
 "Aloo dalna | | rv d s | bengal",
 "Potol dalna | | rv d s | bengal",
 "Santula | | rv b | odisha",
 "Papaya khar | khar | | assam",
 "Nadru yakhni | | d | kashmir",
 "Khatkhate | | c rv | goa",
]);
K("V","Stuffed vegetable","bharwa; bharli; gutti; bharela; bharva","north west andhra","lunch dinner",false,"main","veg",[
 "Bharwa bhindi | stuffed bhindi | og",
 "Bharwa baingan | stuffed baingan | b og",
 "Bharwa karela | stuffed karela | k og",
 "Bharwa tinda | | og",
 "Bharwa parwal | | og",
 "Stuffed capsicum | bharwa shimla mirch | rv og",
 "Gutti vankaya | | b og p | andhra",
 "Bharli vangi | | b og p c | maharashtra",
 "Bharela ringan bateta | | b rv p s | gujarat",
]);
K("V","Kofta curry","kofta; kofte","north","lunch dinner",false,"main","veg",[
 "Lauki kofta | | og",
 "Malai kofta | | d n rv og",
 "Paneer kofta | | d og",
 "Palak kofta | | og",
 "Raw banana kofta | kachche kele ke kofte | og",
]);
K("V","Paneer","paneer sabzi; cottage cheese","north","lunch dinner",false,"main","veg",[
 "Palak paneer | saag paneer | d og",
 "Matar paneer | | d og",
 "Paneer butter masala | | d n s og",
 "Kadai paneer | | d og",
 "Paneer bhurji | | d og",
 "Shahi paneer | | d n og",
 "Paneer tikka masala | | d og",
 "Paneer do pyaza | | d og",
 "Achari paneer | | d og",
]);
K("V","Kerala curry","avial; aviyal; olan; erissery; kalan; theeyal; stew; ishtu; kappa","kerala","breakfast lunch dinner",false,"main","veg",[
 "Aviyal | avial | c d rv",
 "Olan | | c",
 "Erissery | | c",
 "Kalan | | c d rv",
 "Kootu curry | | c rv",
 "Vegetable stew | ishtu | c rv og",
 "Ulli theeyal | theeyal | c og",
 "Pavakka theeyal | | k c og",
 "Kappa puzhukku | kappa; tapioca mash | c rv",
]);
K("V","Bhaja","bhaji (bengali fry)","bengal odisha","lunch dinner",false,"side","veg",[
 "Begun bhaja | | b",
 "Alu bhaja | jhuri alu bhaja | rv",
 "Potol bhaja | |",
 "Uchhe bhaja | korola bhaja | k",
 "Kumro bhaja | pumpkin bhaja |",
 "Beguni | | b",
]);
K("V","Bharta","chokha; pitika; bhorta; bharit; pora","north east bengal assam maharashtra northeast","lunch dinner",false,"side","mixed",[
 "Baingan bharta | | b og",
 "Baingan chokha | | b og | east",
 "Aloo chokha | | rv og | east",
 "Tomato chokha | | og | east",
 "Aloo pitika | | rv og | assam",
 "Begun pora | | b og | bengal",
 "Vangyache bharit | baingan bharit | b og p | maharashtra",
 "Eromba | | f | northeast",
]);

// ---------------- RICE DISHES ----------------
K("R","Pulao","pulav; pilaf; ghee rice; neychoru","north south west east kashmir","lunch dinner tiffin",false,"main","mixed",[
 "Vegetable pulao | veg pulao | r d og rv",
 "Matar pulao | peas pulao | r d og",
 "Paneer pulao | | r d og",
 "Chana pulao | | r og",
 "Kashmiri pulao | | r d n s | kashmir",
 "Ghee rice | neychoru | r d n og | kerala",
 "Coconut milk pulao | thengai paal sadam | r c og | tamil",
 "Basanti pulao | mishti pulao | r d n s | bengal",
 "Tawa pulao | | r d rv og | maharashtra",
 "Yakhni pulao | mutton yakhni pulao | r m d og",
 "Chicken pulao | | r m d og",
]);
K("R","Biryani","biriyani; dum biryani","north south west east","lunch dinner",false,"complete","mixed",[
 "Veg biryani | vegetable biryani | r d og rv",
 "Paneer biryani | | r d og",
 "Mushroom biryani | | r mu d og",
 "Chicken biryani | hyderabadi chicken biryani | r m d og",
 "Mutton biryani | | r m d og",
 "Egg biryani | | r e d og",
 "Fish biryani | | r f d og",
 "Prawn biryani | | r f og",
 "Kolkata biryani | | r m rv e d og | bengal",
 "Malabar biryani | thalassery biryani | r m d n og | kerala",
 "Ambur biryani | dindigul biryani | r m d og | tamil",
]);
K("R","Khichdi","khichri; khichuri; khichadi","north west east","lunch dinner",false,"complete","veg",[
 "Moong dal khichdi | | r d",
 "Masala khichdi | | r d og rv",
 "Vegetable khichdi | | r d rv",
 "Gujarati khichdi | toor dal khichdi | r d | gujarat",
 "Bhuna khichuri | bhoger khichuri | r d rv | bengal",
 "Bajra khichdi | | d | rajasthan",
 "Dalia khichdi | | w d",
]);
K("R","Variety rice","chitranna; kalanda sadam; mixed rice; bath; flavoured rice; pulihora; sadam","south odisha","lunch dinner tiffin",false,"complete","veg",[
 "Lemon rice | chitranna; elumichai sadam; nimmakaya pulihora | r p",
 "Tamarind rice | puliyogare; puliyodharai; pulihora | r p s",
 "Coconut rice | thengai sadam; kayi anna | r c n",
 "Tomato rice | thakkali sadam; tomato bath | r og",
 "Bisi bele bath | | r d n rv | karnataka",
 "Vangi bath | | r b n | karnataka",
 "Mango rice | mangai sadam; mavinakayi chitranna | r p",
 "Sesame rice | ellu sadam | r",
 "Pudina rice | mint rice | r og",
 "Capsicum rice | | r",
 "Pakhala | pakhala bhata | r | odisha",
]);
K("R","Fried rice","chinese rice","indo_chinese","lunch dinner tiffin",false,"complete","mixed",[
 "Veg fried rice | | r so og",
 "Schezwan fried rice | | r so og",
 "Paneer fried rice | | r d so og",
 "Egg fried rice | | r e so og",
 "Chicken fried rice | | r m so og",
]);

// ---------------- INDO-CHINESE & CONTINENTAL ----------------
K("C","Noodles","chowmein; hakka noodles; maggi; instant noodles","indo_chinese","lunch dinner tiffin snack",false,"complete","mixed",[
 "Hakka noodles | veg chowmein | w so og",
 "Schezwan noodles | | w so og",
 "Chilli garlic noodles | | w so og",
 "Maggi | instant noodles | w og",
 "Vegetable maggi | masala maggi | w og",
 "Egg noodles | egg chowmein | w e so og",
 "Chicken noodles | chicken chowmein | w m so og",
]);
K("C","Pasta","macaroni","continental","lunch dinner tiffin",false,"complete","mixed",[
 "White sauce pasta | | w d",
 "Red sauce pasta | | w og",
 "Pink sauce pasta | | w d og",
 "Masala pasta | indian-style pasta | w og",
 "Macaroni | vegetable macaroni | w og",
 "Mac and cheese | | w d",
 "Pesto pasta | | w d n og",
 "Chicken pasta | | w m d og",
]);
K("C","Manchurian","chilli; chinese; gobi manchurian; dry chilli","indo_chinese","dinner snack",false,"main","mixed",[
 "Veg manchurian | | w so og rv",
 "Gobi manchurian | | w so og",
 "Chilli paneer | | d so og w",
 "Chilli mushroom | | mu so og",
 "Chilli potato | honey chilli potato | rv so og s",
 "Chilli baby corn | | so og",
 "Chilli chicken | | m so og e w",
]);
K("C","Soup","shorba","continental indo_chinese","dinner snack",false,"side","mixed",[
 "Tomato soup | | d og | continental",
 "Sweet corn soup | veg sweet corn soup | og | indo_chinese",
 "Hot and sour soup | | so og | indo_chinese",
 "Manchow soup | | so og w | indo_chinese",
 "Mixed vegetable soup | veg clear soup | og rv",
 "Palak soup | spinach soup | d og",
 "Chicken soup | chicken clear soup | m og",
]);

// ---------------- NON-VEG ----------------
K("N","Chicken curry","murgh; kozhi curry; murgir jhol; kodi kura; chicken gravy","north south west east","lunch dinner",false,"main","nonveg",[
 "Chicken curry | home-style chicken curry | m og",
 "Butter chicken | murgh makhani | m og d n s",
 "Chicken korma | | m og d n",
 "Kadai chicken | | m og | north punjab",
 "Chicken do pyaza | | m og",
 "Chicken saagwala | palak chicken | m og",
 "Chettinad chicken | | m og c | tamil",
 "Nadan chicken curry | kerala chicken curry | m og c | kerala",
 "Chicken stew | | m og c rv | kerala",
 "Andhra chicken curry | kodi kura | m og | andhra",
 "Kolhapuri chicken | | m og c | maharashtra",
 "Chicken xacuti | | m og c | goa",
 "Murgir jhol | | m og rv | bengal",
 "Kosha murgi | | m og d | bengal",
]);
K("N","Chicken fry","chicken dry; chicken roast; sukka; chicken varuval; chicken starter","north south west east","lunch dinner snack",false,"main","nonveg",[
 "Chicken fry | kozhi varuval | m og",
 "Chicken 65 | | m og e d",
 "Pepper chicken | | m og",
 "Chicken sukka | kori sukka | m og c | karnataka",
 "Chicken ghee roast | | m og d | karnataka",
 "Kerala chicken roast | | m og | kerala",
 "Tandoori chicken | | m og d",
 "Chicken tikka | | m og d",
]);
K("N","Mutton curry","gosht; mangsho; lamb curry; goat curry; mutton","north south west east","lunch dinner",false,"main","nonveg",[
 "Mutton curry | home-style mutton curry; goat curry | m og",
 "Mutton korma | | m og d n",
 "Rogan josh | | m og d | kashmir",
 "Mutton yakhni | | m d | kashmir",
 "Laal maas | | m og d | rajasthan",
 "Kosha mangsho | | m og d | bengal",
 "Mangshor jhol | | m og rv | bengal",
 "Mutton sukka | | m og c | karnataka",
 "Kerala mutton roast | | m og | kerala",
 "Mutton stew | | m og c rv | kerala",
 "Tambda rassa | kolhapuri mutton | m og c | maharashtra",
 "Dalcha | | m og | andhra",
 "Dhansak | | m og b s | parsi",
 "Salli boti | | m og rv s | parsi",
]);
K("N","Keema","kheema; qeema; mince","north west","breakfast lunch dinner",false,"main","nonveg",[
 "Keema matar | | m og",
 "Keema aloo | aloo keema | m og rv",
 "Chicken keema | | m og",
 "Keema pav | | m og w | maharashtra",
]);
K("N","Pork","pork curry; sorpotel; vindaloo; pandi curry","goa northeast karnataka","lunch dinner",false,"main","nonveg",[
 "Pork curry | | m og",
 "Pork vindaloo | | m og s | goa",
 "Sorpotel | | m og | goa",
 "Pandi curry | coorg pork curry | m og | karnataka",
 "Smoked pork with bamboo shoot | naga pork | m og | northeast",
 "Pork with akhuni | pork with axone | m og so | northeast",
]);
K("N","Fish curry","machli; meen curry; macher jhol; maach; chepala pulusu; ambot tik; tenga; mach","south west east bengal kerala goa","lunch dinner",false,"main","nonveg",[
 "Fish masala curry | machli curry; machli ka salan | f og",
 "Macher jhol | maacher jhol | f og rv | bengal",
 "Shorshe maach | shorshe ilish; mustard fish | f | bengal",
 "Doi maach | | f d og s | bengal",
 "Meen kuzhambu | meen kulambu | f og | tamil",
 "Kerala fish curry | meen curry; kudampuli fish curry | f og c | kerala",
 "Fish moilee | meen molee | f og c | kerala",
 "Goan fish curry | | f og c | goa",
 "Ambot tik | | f og | goa",
 "Malvani fish curry | | f og c | maharashtra",
 "Fish gassi | meen gassi | f og c | karnataka",
 "Chepala pulusu | | f og | andhra",
 "Masor tenga | | f | assam",
 "Machha besara | | f og | odisha",
]);
K("N","Fish fry","meen varuval; maach bhaja; tawa fish","south west east bengal","lunch dinner snack",false,"side","nonveg",[
 "Masala fish fry | tawa fish fry | f og",
 "Rava fish fry | | f w",
 "Meen varuval | meen varuthathu | f og | south",
 "Maach bhaja | | f | bengal",
 "Amritsari fish | | f og e | punjab",
 "Bombil fry | bombay duck fry | f w r | maharashtra",
 "Pomfret fry | paplet fry | f og w | maharashtra goa",
]);
K("N","Prawn","prawns; jhinga; chingri; kolambi; royyalu; eral; konju; shrimp","south west east bengal goa kerala","lunch dinner",false,"main","nonveg",[
 "Prawn curry | eral kuzhambu; kolambi curry | f og c",
 "Prawn masala | | f og",
 "Prawn fry | prawn rava fry; kolambi fry | f og",
 "Chingri malai curry | | f og c | bengal",
 "Prawn balchao | | f og s | goa",
 "Prawn ghee roast | | f og d | karnataka",
 "Royyala iguru | | f og | andhra",
]);
K("N","Egg curry","anda curry; muttai kuzhambu; dimer dalna; egg masala","north south west east","lunch dinner",false,"main","egg",[
 "Egg curry | anda curry | e og",
 "Egg masala | | e og",
 "Egg roast | mutta roast | e og | kerala",
 "Egg stew | | e og c rv | kerala",
 "Dimer dalna | dimer jhol | e og rv | bengal",
 "Muttai kuzhambu | | e og | tamil",
]);

// ---------------- SIDES ----------------
K("SD","Raita","pachadi; thayir pachadi; perugu pachadi","north south west east","lunch dinner",false,"side","veg",[
 "Boondi raita | | d",
 "Cucumber raita | kheera raita | d",
 "Onion raita | onion tomato raita | d og",
 "Mixed vegetable raita | | d og",
 "Mint raita | pudina raita | d",
 "Pineapple raita | | d s",
 "Aloo raita | | d rv",
 "Lauki raita | | d",
 "Beetroot raita | | d rv",
 "Vellarikka pachadi | cucumber pachadi; thayir pachadi | d c | south",
]);
K("SD","Salad","kachumber; koshimbir; kosambari","north south west east","lunch dinner tiffin snack",false,"side","veg",[
 "Kachumber | kachumber salad | og",
 "Green salad | sliced salad | og",
 "Koshimbir | kakdi koshimbir | p d | maharashtra",
 "Kosambari | hesarubele kosambari | c | karnataka",
 "Sprouts salad | moong sprouts salad | og",
 "Carrot salad | | rv",
 "Beetroot salad | | rv",
 "Corn salad | sweet corn salad |",
 "Cucumber salad | kakdi salad; kheera salad |",
 "Laccha onion | laccha pyaaz; onion salad | og",
 "Fruit chaat | fruit salad |",
 "Chana salad | chickpea salad | og",
]);
K("SD","Chutney","chatni; thogayal; thuvaiyal; chammanthi; podi; pachadi (andhra)","north south west east","breakfast lunch dinner snack",false,"side","veg",[
 "Coconut chutney | thengai chutney; kobbari pachadi | c",
 "Tomato chutney | thakkali chutney | og",
 "Onion tomato chutney | kara chutney | og",
 "Onion chutney | vengaya chutney | og",
 "Mint chutney | pudina chutney; hari chutney | og",
 "Coriander chutney | dhaniya chutney; green chutney |",
 "Peanut chutney | palli chutney; shenga chutney | p og",
 "Tamarind chutney | imli chutney; saunth | s",
 "Gongura chutney | gongura pachadi | og | andhra",
 "Beerakaya pachadi | ridge gourd chutney | og | andhra",
 "Dry garlic chutney | lasun chutney | og c p | maharashtra",
 "Thecha | hirvi mirchi thecha | og p | maharashtra",
 "Shenga chutney pudi | peanut chutney powder | p og | karnataka",
 "Idli podi | gunpowder; milagai podi; chutney powder | | south",
 "Chammanthi | thenga chammanthi | c og | kerala",
 "Tomato khejur chutney | bengali tomato chutney | s | bengal",
]);
K("SD","Pickle","achar; achaar; oorugai; uppinakayi; avakaya; lonacha","north south west east","breakfast lunch dinner tiffin",false,"side","veg",[
 "Mango pickle | aam ka achar; maangai oorugai | ",
 "Avakaya | | og | andhra",
 "Lime pickle | nimbu achar; elumichai oorugai |",
 "Mixed pickle | | rv",
 "Garlic pickle | lehsun achar | og",
 "Green chilli pickle | hari mirch achar |",
 "Gongura pickle | | og | andhra",
 "Amla pickle | |",
 "Carrot pickle | gajar achar | rv",
 "Sweet mango pickle | chhundo | s | gujarat",
]);
K("SD","Papad","appalam; pappadam; papadum; happala","north south west east","lunch dinner",false,"side","veg",[
 "Roasted papad | |",
 "Fried papad | |",
 "Masala papad | | og",
 "Appalam | | | tamil",
 "Pappadam | | | kerala",
 "Sabudana papad | |",
 "Rice papad | | r",
]);
K("SD","Buttermilk","chaas; chhachh; mor; majjige; taak; lassi","north south west east","lunch dinner snack",false,"drink","veg",[
 "Chaas | buttermilk; chhachh; taak | d",
 "Masala chaas | spiced buttermilk | d",
 "Neer mor | majjige | d | south",
 "Sweet lassi | | d s",
 "Salted lassi | | d",
 "Sol kadhi | | c | maharashtra goa",
]);

// ---------------- SNACKS & TIFFIN ----------------
K("T","Fruit","phal; cut fruit","north south west east continental","breakfast tiffin snack",false,"snack","veg",[
 "Seasonal fruit | cut fruit |",
 "Banana | |",
 "Apple slices | |",
 "Papaya | |",
 "Fruit custard | | d s",
]);
K("T","Roll","frankie; kathi roll; wrap","north bengal west","tiffin dinner snack",false,"complete","mixed",[
 "Paneer roll | paneer frankie | w d og",
 "Veg frankie | | w rv og",
 "Aloo roll | | w rv",
 "Chapati roll | roti roll; sabzi roll | w",
 "Egg roll | anda roll | w e og | bengal",
 "Chicken kathi roll | chicken roll | w m og",
]);
K("T","Namkeen","chivda; mixture; farsan; chakli; murukku; dry snack","north south west east","tiffin snack",false,"snack","veg",[
 "Poha chivda | chivda | r p n s",
 "Cornflakes chivda | | p n s",
 "Murmura chivda | puffed rice chivda; kurmura | r p",
 "Mixture | south indian mixture; madras mixture | p",
 "Khakhra | | w | gujarat",
 "Mathri | | w | north",
 "Chakli | murukku | r",
 "Banana chips | nendran chips | | kerala",
 "Shankarpali | shakkarpara | w s d | maharashtra",
 "Bhakarwadi | | w s | maharashtra",
 "Masala peanuts | | p",
 "Roasted chana | bhuna chana |",
]);
K("T","Cutlet","tikki; patties","north south west east","tiffin snack",false,"snack","mixed",[
 "Veg cutlet | vegetable cutlet | rv w",
 "Aloo tikki | | rv",
 "Poha cutlet | | r rv",
 "Beetroot cutlet | | rv w",
 "Paneer cutlet | | d rv w",
 "Fish cutlet | | f rv w e",
 "Chicken cutlet | | m rv w e",
]);
K("T","Pakora","pakoda; bhajji; bajji; bhajiya; bonda; fritters","north south west east","snack",false,"snack","veg",[
 "Onion pakora | kanda bhaji; pyaaz pakoda; onion bajji | og",
 "Aloo pakora | aloo bajji | rv",
 "Palak pakora | |",
 "Paneer pakora | | d",
 "Gobi pakora | |",
 "Mirchi bajji | mirchi pakora; mirchi vada |",
 "Moong dal pakoda | | og",
 "Bread pakora | | w rv",
 "Aloo bonda | batata bonda | rv",
 "Mysore bonda | | w d",
 "Punugulu | | r og | andhra",
 "Goli baje | mangalore bajji | w d | karnataka",
]);
K("T","Samosa","singara; shingara","north east","snack",false,"snack","mixed",[
 "Aloo samosa | punjabi samosa | w rv",
 "Onion samosa | | w og | andhra",
 "Patti samosa | | w og",
 "Shingara | | w rv p | bengal",
 "Keema samosa | | w m og",
]);
K("T","Vada","vadai; wada","south west","breakfast snack",false,"snack","veg",[
 "Medu vada | uzhunnu vada; ulundu vadai | og",
 "Masala vada | paruppu vadai; dal vada | og",
 "Sambar vada | sambar vadai | og",
 "Batata vada | aloo vada | rv og",
 "Vada pav | | w rv og | maharashtra",
 "Maddur vada | | w og | karnataka",
 "Rava vada | | w og",
]);
K("T","Chaat","chat","north west east","snack",false,"snack","veg",[
 "Bhel puri | bhel | r og s",
 "Sev puri | | w rv og s",
 "Pani puri | golgappa; puchka | w rv",
 "Dahi puri | | w d s rv",
 "Papdi chaat | | w d s rv",
 "Raj kachori | | w d s rv",
 "Aloo tikki chaat | | rv d s",
 "Dahi vada | dahi bhalla; thayir vadai | d s",
 "Ragda pattice | | rv og",
 "Jhal muri | | r og p | bengal",
 "Chana chaat | kala chana chaat | og",
 "Masala corn | corn chaat; bhutta | d",
 "Sweet potato chaat | shakarkandi chaat | rv",
]);
K("T","Sundal","sundal","tamil","tiffin snack",false,"snack","veg",[
 "Chana sundal | kondakadalai sundal | c",
 "Peanut sundal | verkadalai sundal | p c",
 "Karamani sundal | lobia sundal | c",
 "Pattani sundal | peas sundal | c",
 "Pachai payaru sundal | green moong sundal | c",
]);
K("T","Makhana","phool makhana; fox nuts; lotus seeds","north","snack tiffin",false,"snack","veg",[
 "Roasted makhana | | d",
 "Masala makhana | | d",
]);

// ---------------- SWEETS ----------------
K("SW","Kheer","payasam; payesh; payas; kheeri; pradhaman","north south west east","lunch dinner snack",false,"sweet","veg",[
 "Rice kheer | chawal ki kheer; paal payasam; payesh | r d s n",
 "Semiya payasam | seviyan kheer; vermicelli kheer | w d s n",
 "Sabudana kheer | javvarisi payasam | d s n",
 "Makhana kheer | | d s n",
 "Lauki kheer | | d s n",
 "Phirni | | r d s n | north",
 "Ada pradhaman | | r c s n | kerala",
 "Parippu payasam | | c s n d | kerala",
 "Sakkarai pongal | sweet pongal; chakkara pongali | r d s n | south",
]);
K("SW","Halwa","sheera; shira; kesari; kesari bath; halua","north south west east","breakfast lunch dinner snack",false,"sweet","veg",[
 "Suji halwa | sooji halwa; sheera; shira | w d s n",
 "Rava kesari | kesari bath; kesari | w d s n | south",
 "Pineapple kesari | | w d s n | south",
 "Banana sheera | | w d s n | maharashtra",
 "Aate ka halwa | atte ka sheera | w d s n",
 "Gajar halwa | gajar ka halwa | rv d s n",
 "Moong dal halwa | | d s n",
 "Lauki halwa | dudhi halwa | d s n",
]);
K("SW","Ladoo","laddu; unde; naru","north south west east","snack",false,"sweet","veg",[
 "Besan ladoo | | d s n",
 "Rava ladoo | | w d c s n",
 "Coconut ladoo | nariyal ladoo; narkel naru | c s d",
 "Til ladoo | til gul | s p",
 "Dry fruit ladoo | | n",
 "Atta ladoo | pinni; aate ke ladoo | w d s n",
 "Gond ladoo | | w d s n",
 "Ragi ladoo | | d s n",
 "Peanut ladoo | shenga ladoo | p s",
]);


// ---------------- OWNER GRAIN DECISIONS (2026-11-25) ----------------
function withCuisine(item, c) {
  const p = item.split("|"); while (p.length < 4) p.push("");
  if (c && !p[3].trim()) p[3] = " " + c;
  return p.join("|");
}
function merge(newKind, sources) {
  const at = kinds.findIndex((k) => k.name === sources[0][0]);
  for (const [name, c] of sources) {
    const i = kinds.findIndex((k) => k.name === name);
    if (i < 0) throw new Error("no kind " + name);
    newKind.items.push(...kinds[i].items.map((it) => withCuisine(it, c)));
  }
  const names = new Set(sources.map((x) => x[0]));
  const rest = kinds.filter((k) => !names.has(k.name) || k.name === sources[0][0]);
  rest[rest.findIndex((k) => k.name === sources[0][0])] = newKind;
  kinds.length = 0; kinds.push(...rest);
}
const mk = (group, name, aka, cuisines, meals, staple, part, diet) => ({ group, name, aka, cuisines, meals, staple, part, diet, items: [] });
// 1. Dal covers every lentil and legume dal (rajma, chole, usal...).
merge(mk("D","Dal","daal; pappu; paruppu; amti; varan; dali; dalma; tovve; bele; parippu; lentils; rajma; chole; chhole; chana; usal; lobia; ghugni; kadala curry; kabuli chana; rassa","north south west east central","lunch dinner",false,"main","veg"),
  [["Dal"],["Legume curry"]]);
// 2. Rice curry: the curries eaten with rice.
merge(mk("D","Rice curry","sambar; sambhar; rasam; kuzhambu; kulambu; kootu; kadhi; kadi; saaru; charu; pulusu; mor kuzhambu; majjige huli; pulissery; huli; gojju","south north west sindhi","breakfast lunch dinner",false,"main","veg"),
  [["Sambar","south"],["Rasam","south"],["Kuzhambu"],["Kootu","tamil kerala"],["Kadhi"]]);
// 3. One-pot rice: a whole plate, no gravy needed. Pulao stays its own kind (main, pairs with dal/curry).
// Owner review 3: one-pot rice split into Khichdi (savoury pongal is the South Indian khichdi),
// Biryani (its own kind, defined above) and Flavoured rice. Each is a whole plate.
merge(mk("R","Khichdi","khichri; khichuri; khichadi; pongal; ven pongal; khara pongal; huggi; pongali","north south west east","breakfast lunch dinner",false,"complete","veg"),
  [["Khichdi"],["Pongal","south"]]);
merge(mk("R","Flavoured rice","variety rice; chitranna; kalanda sadam; mixed rice; bath; pulihora; sadam","south odisha","lunch dinner tiffin",false,"complete","veg"),
  [["Variety rice"]]);


// ---------------- OWNER REVIEW 2 (2026-11-25): folds ----------------
function kindIdx(n) { const i = kinds.findIndex((k) => k.name === n); if (i < 0) throw new Error("no kind " + n); return i; }
function fold(src, dst, c) {
  const s = kinds[kindIdx(src)], d = kinds[kindIdx(dst)];
  d.items.push(...s.items.map((it) => withCuisine(it, c)));
  d.aka = [d.aka, src.toLowerCase(), s.aka].filter(Boolean).join("; ");
  kinds.splice(kindIdx(src), 1);
}
function moveItem(name, dst, replacement) {
  for (const k of kinds) {
    const i = k.items.findIndex((it) => it.split("|")[0].trim() === name);
    if (i >= 0) { const [it] = k.items.splice(i, 1); kinds[kindIdx(dst)].items.push(replacement || it); return; }
  }
  throw new Error("no item " + name);
}
// Pav meal: pav bhaji, misal pav, vada pav, dabeli are items of one kind.
merge(mk("B","Pav meal","pav bhaji; bhaji pav; misal; misal pav; usal pav; vada pav; dabeli; pav","maharashtra gujarat","breakfast dinner snack",false,"complete","veg"),
  [["Misal"],["Pav bhaji"]]);
moveItem("Vada pav", "Pav meal");
// Sabudana is an ingredient, not a kind: its dishes go to their kinds.
moveItem("Sabudana khichdi", "Upma", "Sabudana khichdi | sabudana upma; javvarisi upma; sago upma | p rv | maharashtra gujarat north");
moveItem("Sabudana vada", "Vada", "Sabudana vada | | p rv | maharashtra gujarat north");
moveItem("Sabudana thalipeeth", "Thalipeeth");
kinds.splice(kindIdx("Sabudana"), 1);
// Thin kinds folded into the family they belong to.
fold("Pesarattu", "Dosa", "andhra");
fold("Adai", "Dosa", "tamil kerala");
fold("Handvo", "Dhokla");
fold("Pithla", "Dal", "maharashtra");
fold("Makhana", "Namkeen", "north");

// ---------------- SUGGEST (owner rules 1-3) ----------------
// Suggestable = differs by main ingredient. Not suggested: shape/style/regional name of the same dish,
// special equipment, restaurant-style, ingredients a normal household doesn't keep, and every staple.
const NO_SUGGEST_KINDS = new Set(["Roti", "Bhakri", "Rice", "Curd", "Mudde", "Puri"]);
// Owner round 5: recognised only = the same dish in another shape, or needing other equipment or its own plate.
// Flavour-base variants (tempering, sauce, masala, filling, topping) are suggestable.
const NO_SUGGEST = new Set(`
Kanchipuram idli|Mini idli|Thatte idli|Sambar idli
Set dosa|Kal dosai|Plain uttapam
Lachha paratha|Ammini kozhukattai|Sandwich dhokla
Puli pitha|Bhapa pitha|Enduri pitha|Poda pitha
Tandoori chicken|Chicken tikka
`.split(/[|\n]/).map((x) => x.trim()).filter(Boolean));

// Owner review 4: Uttapam is a Dosa; one Gravy kind (gravy sabzi + paneer gravies + kofta curries).
fold("Uttapam", "Dosa");
moveItem("Paneer bhurji", "Sabzi");
merge(mk("V","Gravy","gravy sabzi; rasedar sabzi; curry; tari wali sabzi; masala; korma; kurma; kofta; kofta curry; salan; rassa; dalna; shaak; paneer; paneer sabzi","north south west east","lunch dinner",false,"main","veg"),
  [["Gravy sabzi"],["Paneer"],["Kofta curry"]]);

// Owner review 3: a regional style of a dish listed elsewhere is suggested only to a family whose
// cuisine profile includes one of the item's cuisines (regional: true; item must carry cuisines).
const REGIONAL = new Set(`
Neer dosa|Indori poha|Dadpe pohe|Aval upma|Avalakki oggarane|Aval nanachathu|Chire bhaja|Doi chire|Sindhi koki|Pathiri|Hing kochuri|Lapsi|Bombay sandwich|Akuri|Egg podimas|Scrambled eggs
Dal makhani|Panchmel dal|Khatti dal|Gujarati dal|Varan|Amti|Muddha pappu|Palakura pappu|Paruppu|Kerala parippu curry|Tovve|Cholar dal|Bengali masoor dal|Sona moong dal|Dalma|Sai bhaji|Jammu rajma|Pindi chole|Ghugni|Kadala curry|Chana ghassi|Vatana usal
Arachuvitta sambar|Udupi sambar|Kerala sambar|Mysore rasam|Udupi saaru|Mukkala pulusu|Rajasthani kadhi|Maharashtrian kadhi|Majjige huli|Pulissery
Bateta nu shaak|Haak|Ker sangri|Beans poriyal|Cabbage thoran|Urulaikizhangu roast|Senai roast|Kovakkai fry|Bendakaya vepudu|Dondakaya vepudu|Shukto|Chorchori|Lau ghonto|Aloo posto|Bandhakopir torkari
Kashmiri dum aloo|Vegetable kurma|Sev tameta|Undhiyu|Aloo dalna|Potol dalna|Santula|Papaya khar|Khatkhate
Gutti vankaya|Bharli vangi|Bharela ringan bateta
Baingan chokha|Aloo pitika|Begun pora|Vangyache bharit|Eromba
Kashmiri pulao|Ghee rice|Coconut milk pulao|Basanti pulao|Tawa pulao
Gujarati khichdi|Bhuna khichuri|Kolkata biryani|Malabar biryani|Ambur biryani|Pakhala
Kadai chicken|Chettinad chicken|Nadan chicken curry|Chicken stew|Andhra chicken curry|Kolhapuri chicken|Chicken xacuti|Murgir jhol|Kosha murgi
Chicken sukka|Chicken ghee roast|Kerala chicken roast
Rogan josh|Mutton yakhni|Laal maas|Kosha mangsho|Mangshor jhol|Mutton sukka|Kerala mutton roast|Mutton stew|Tambda rassa|Dhansak|Salli boti
Pork vindaloo|Sorpotel|Pandi curry|Smoked pork with bamboo shoot|Pork with akhuni
Macher jhol|Shorshe maach|Doi maach|Meen kuzhambu|Kerala fish curry|Fish moilee|Goan fish curry|Ambot tik|Malvani fish curry|Fish gassi|Chepala pulusu|Masor tenga|Machha besara
Meen varuval|Maach bhaja|Amritsari fish|Bombil fry|Pomfret fry
Chingri malai curry|Prawn balchao|Prawn ghee roast|Royyala iguru
Egg roast|Egg stew|Dimer dalna|Muttai kuzhambu
Vellarikka pachadi|Gongura chutney|Dry garlic chutney|Thecha|Shenga chutney pudi|Chammanthi|Tomato khejur chutney
Avakaya|Gongura pickle|Sweet mango pickle|Appalam|Pappadam|Neer mor|Sol kadhi
Punugulu|Goli baje|Shingara|Maddur vada|Jhal muri
Phirni|Ada pradhaman|Sakkarai pongal|Rava kesari|Pineapple kesari|Banana sheera
`.split(/[|\n]/).map((x) => x.trim()).filter(Boolean));

// ---------------- OWNER ROUND 6 (2026-11-25): coarse kinds with sub-kinds ----------------
// Lunch/dinner kinds are coarse; each item carries a "sub" (the name families use, often regional).
// Templates name a kind or a sub-kind; rotation prefers the family's own sub-kinds.
const SRC = new Map();
for (const k of kinds) for (const it of k.items) SRC.set(it.split("|")[0].trim(), k.name);
moveItem("Chicken keema", "Chicken curry");
merge(mk("V","Sabzi","sabji; subzi; sukhi sabzi; dry sabzi; bhaji; poriyal; porial; thoran; torkari; palya; vepudu; upkari; shaak; fugath; sukke; bhaja; bharta; chokha; pitika; bharit; bharwa; bharli; stuffed vegetable","north south west east central","lunch dinner tiffin",false,"main","mixed"),
  [["Sabzi"],["Bhaja"],["Bharta"],["Stuffed vegetable"]]);
merge(mk("V","Gravy","gravy sabzi; rasedar sabzi; curry; tari wali sabzi; masala; korma; kurma; kofta; kofta curry; salan; rassa; dalna; shaak; paneer; paneer sabzi; avial; olan; erissery; kalan; theeyal; stew; ishtu","north south west east","breakfast lunch dinner",false,"main","veg"),
  [["Gravy"],["Kerala curry","kerala"]]);
merge(mk("N","Chicken","chicken; murgh; kozhi; kodi; chicken curry; chicken fry; chicken dry","north south west east","lunch dinner snack",false,"main","nonveg"),
  [["Chicken curry"],["Chicken fry"]]);
merge(mk("N","Mutton","mutton; gosht; mangsho; lamb; goat; keema; kheema; mince","north south west east","breakfast lunch dinner",false,"main","nonveg"),
  [["Mutton curry"],["Keema"]]);
merge(mk("N","Fish & seafood","fish; machli; meen; maach; mach; seafood; prawns; jhinga; chingri; kolambi; royyalu; eral; shrimp","north south west east","lunch dinner snack",false,"main","nonveg"),
  [["Fish curry"],["Fish fry"],["Prawn"]]);
merge(mk("N","Egg","eggs; anda; muttai; egg curry; anda curry","north south west east","breakfast lunch dinner tiffin",false,"main","egg"),
  [["Eggs"],["Egg curry"]]);
const S = ALL;
const SUBDEF = {
  Sabzi: [["Sabzi","sukhi sabzi; bhaji; shaak; sukke; fugath","north west central"],["Poriyal/Thoran","poriyal; porial; thoran; upkari; palya","south"],["Vepudu","vepudu","andhra"],["Torkari/Ghonto","torkari; ghonto; chorchori; posto","bengal odisha"],["Bhaja","bhaja","bengal odisha"],["Bharta/Chokha","bharta; chokha; pitika; bhorta; bharit; pora","north east bengal assam maharashtra northeast"],["Bharwa","bharwa; bharli; gutti; bharela; stuffed","north west andhra"]],
  Gravy: [["Curry","rasedar sabzi; tari wali sabzi; masala; rassa; shaak; salan","north west east"],["Paneer","paneer sabzi; paneer gravy","north"],["Kofta","kofta curry; kofte","north"],["Kurma","korma; kurma","south"],["Dalna","dalna","bengal"],["Kerala curry","avial; aviyal; olan; erissery; kalan; theeyal; stew; ishtu","kerala"]],
  Dal: [["Dal","daal; dal tadka; dal fry","north central east"],["Rajma/Chole","rajma; chole; chana; usal; lobia; ghugni; kadala curry; legume curry",S],["Pappu","pappu","andhra"],["Amti/Varan","amti; aamti; varan","maharashtra"],["Pithla/Zunka","pithla; pitla; zunka; jhunka","maharashtra"],["Gujarati dal","khatti meethi dal","gujarat"],["Bengali dal","cholar dal; musur dal; bhaja moong dal","bengal"],["Dalma","dalma","odisha"],["Paruppu","paruppu; parippu; tovve; bele","tamil kerala karnataka"]],
  "Rice curry": [["Sambar","sambhar; huli","south"],["Rasam","saaru; charu","south"],["Kuzhambu/Pulusu","kuzhambu; kulambu; pulusu; gojju","tamil andhra karnataka"],["Kootu","koottu","tamil kerala"],["Kadhi","kadi","north west sindhi"],["Mor kuzhambu/Pulissery","mor kuzhambu; majjige huli; pulissery; moru curry","tamil karnataka kerala"]],
  Chicken: [["Curry","chicken curry; murgh; kozhi curry; kodi kura; chicken gravy",S],["Fry/Dry","chicken fry; chicken dry; sukka; roast; varuval",S],["Keema","chicken keema; chicken mince","north west"]],
  Mutton: [["Curry","mutton curry; gosht; mangsho; mangshor jhol",S],["Fry/Dry","mutton fry; sukka; roast","south"],["Keema","kheema; qeema; mince","north west"]],
  "Fish & seafood": [["Fish curry","macher jhol; meen curry; meen kuzhambu; chepala pulusu; ambot tik; tenga; machli curry",S],["Fish fry","maach bhaja; meen varuval; tawa fish",S],["Prawn","prawns; jhinga; chingri; kolambi; royyalu; eral; shrimp",S]],
  Egg: [["Eggs","omelette; bhurji; anda; boiled eggs",S],["Egg curry","anda curry; muttai kuzhambu; dimer dalna; egg masala",S]],
  Khichdi: [["Khichdi","khichri; khichuri; khichadi","north west east"],["Pongal","ven pongal; khara pongal; huggi; pongali","south"]],
  "Pav meal": [["Misal","misal pav; usal pav; usal","maharashtra"],["Pav bhaji","bhaji pav; masala pav","maharashtra gujarat"],["Vada pav","dabeli","maharashtra gujarat"]],
};
const LEGUME = new Set(["Rajma","Jammu rajma","Chole","Pindi chole","Kala chana curry","Lobia","Safed matar","Ghugni","Kadala curry","Chana ghassi","Sprouts curry","Matki usal","Moong usal","Vatana usal"]);
function subOf(kind, name, cuis) {
  const src = SRC.get(name), has = (...c) => c.some((x) => cuis.includes(x));
  switch (kind) {
    case "Sabzi":
      if (src === "Bhaja") return "Bhaja";
      if (src === "Bharta") return "Bharta/Chokha";
      if (src === "Stuffed vegetable") return "Bharwa";
      if (has("andhra")) return "Vepudu";
      if (has("south", "tamil", "kerala", "karnataka")) return "Poriyal/Thoran";
      if (has("bengal", "odisha")) return "Torkari/Ghonto";
      return "Sabzi";
    case "Gravy":
      if (src === "Kerala curry") return "Kerala curry";
      if (/paneer/i.test(name)) return "Paneer";
      if (/kofta/i.test(name)) return "Kofta";
      if (/dalna/i.test(name)) return "Dalna";
      if (/kurma/i.test(name)) return "Kurma";
      return "Curry";
    case "Dal":
      if (LEGUME.has(name)) return "Rajma/Chole";
      if (/pappu/i.test(name)) return "Pappu";
      if (["Varan", "Amti"].includes(name)) return "Amti/Varan";
      if (["Pithla", "Zunka"].includes(name)) return "Pithla/Zunka";
      if (name === "Dalma") return "Dalma";
      if (name === "Gujarati dal") return "Gujarati dal";
      if (["Cholar dal", "Bengali masoor dal", "Sona moong dal"].includes(name)) return "Bengali dal";
      if (["Paruppu", "Kerala parippu curry", "Tovve"].includes(name)) return "Paruppu";
      return "Dal";
    case "Rice curry":
      if (/sambar/i.test(name)) return "Sambar";
      if (/rasam|saaru/i.test(name)) return "Rasam";
      if (/kootu/i.test(name)) return "Kootu";
      if (["Mor kuzhambu", "Majjige huli", "Pulissery"].includes(name)) return "Mor kuzhambu/Pulissery";
      if (/kadhi/i.test(name)) return "Kadhi";
      return "Kuzhambu/Pulusu";
    case "Chicken": return name === "Chicken keema" ? "Keema" : src === "Chicken fry" ? "Fry/Dry" : "Curry";
    case "Mutton": return src === "Keema" ? "Keema" : ["Mutton sukka", "Kerala mutton roast"].includes(name) ? "Fry/Dry" : "Curry";
    case "Fish & seafood": return src === "Fish fry" ? "Fish fry" : src === "Prawn" ? "Prawn" : "Fish curry";
    case "Egg": return src === "Eggs" ? "Eggs" : "Egg curry";
    case "Khichdi": return /pongal/i.test(name) ? "Pongal" : "Khichdi";
    case "Pav meal": return /misal|usal/i.test(name) ? "Misal" : /bhaji|masala pav/i.test(name) ? "Pav bhaji" : "Vada pav";
  }
  return kind;
}

// ---------------- OWNER ROUND 7 (2026-11-25): meals = where NEW items may be suggested ----------------
// A kind's, sub-kind's or item's meals say where the planner may suggest a new item of it. They never limit matching:
// a family's own dish at a meal outside its meals is planned as that fixed item (a template part of items, nothing new
// suggested for it), e.g. "appam with stew" = [Appam, items: Vegetable stew]. Sub-kind meals default to the kind's;
// item meals default to the sub-kind's; the kind's emitted meals are the union of its parts'.
const KIND_MEALS = { Gravy: "lunch dinner", "Rice curry": "lunch dinner", Mutton: "lunch dinner", Khichdi: "lunch dinner", Halwa: "lunch dinner snack" };
const SUB_MEALS = {
  "Rice curry": { Sambar: "breakfast lunch dinner tiffin" },
  Khichdi: { Pongal: "breakfast dinner" },
  Egg: { Eggs: "breakfast dinner tiffin snack", "Egg curry": "lunch dinner" },
  Chicken: { Curry: "lunch dinner", Keema: "lunch dinner" },
  "Fish & seafood": { "Fish curry": "lunch dinner", Prawn: "lunch dinner" },
  "Pav meal": { Misal: "breakfast dinner snack", "Pav bhaji": "dinner snack", "Vada pav": "snack" },
};
const ITEM_MEALS = {
  "Suji halwa": "breakfast lunch dinner snack", "Rava kesari": "breakfast lunch dinner snack", "Pineapple kesari": "breakfast lunch dinner snack", "Banana sheera": "breakfast lunch dinner snack",
  "Masala vada": "snack", "Batata vada": "snack", "Maddur vada": "snack", "Sabudana vada": "snack",
};
for (const [n, m] of Object.entries(KIND_MEALS)) kinds[kindIdx(n)].meals = m;

// ---------------- BUILD ----------------
const errors = [];
const MEAT_OVERRIDE = { "Ambur biryani": ["chicken", "mutton"], "Kolkata biryani": ["chicken", "mutton"], "Malabar biryani": ["chicken"] };
function resolveTag(t, name, kind) {
  if (t === "m") {
    if (MEAT_OVERRIDE[name]) return MEAT_OVERRIDE[name];
    if (kind === "Pork") return ["pork"];
    return [/chicken|murg|kodi|kozhi|kori/i.test(name) ? "chicken" : "mutton"];
  }
  if (t === "f") return [kind === "Prawn" || /prawn|chingri/i.test(name) ? "prawn" : "fish"];
  return [T[t]];
}
function dietOf(tags) {
  if (tags.some((t) => PARENTS[t])) return "nonveg";
  if (tags.includes("egg")) return "egg";
  return "veg";
}
const usedNo = new Set(), usedReg = new Set(), usedMeals = new Set();
const out = { version: 1, tags: TAGS, parents: PARENTS, kinds: [] };
for (const k of kinds) {
  const kc = sp(k.cuisines);
  for (const c of kc) if (!CUISINES.includes(c)) errors.push(`${k.name}: cuisine ${c}`);
  const kindMeals = sp(k.meals);
  const ordered = (ms) => [...MEALS.filter((m) => ms.includes(m)), ...ms.filter((m) => !MEALS.includes(m))];
  const subMeals = (sb) => ordered(sp((SUB_MEALS[k.name] || {})[sb]).length ? sp(SUB_MEALS[k.name][sb]) : kindMeals);
  for (const sb of Object.keys(SUB_MEALS[k.name] || {})) if (!(SUBDEF[k.name] || []).some(([n]) => n === sb)) errors.push(`SUB_MEALS: ${k.name} has no sub ${sb}`);
  if (!PARTS.includes(k.part)) errors.push(`${k.name}: part ${k.part}`);
  const items = k.items.map((s) => {
    const [name, aka, tags, cuis] = s.split("|").map((x) => (x || "").trim());
    const it = { name };
    const a = semi(aka);
    if (a.length) it.aka = a;
    const ic = sp(cuis);
    for (const c of ic) if (!CUISINES.includes(c)) errors.push(`${name}: cuisine ${c}`);
    if (ic.length) it.cuisines = ic;
    const contains = [...new Set(sp(tags).flatMap((t) => { if (!T[t]) errors.push(`${name}: tag ${t}`); return resolveTag(t, name, k.name); }))];
    it.contains = contains;
    const d = dietOf(contains);
    if (k.diet === "mixed") it.diet = d;
    else if (d !== k.diet) errors.push(`${name}: diet ${d} in ${k.diet} kind ${k.name}`);
    const regional = REGIONAL.has(name);
    if (regional && !it.cuisines) errors.push("regional item without cuisines: " + name);
    if (regional && (k.staple || NO_SUGGEST_KINDS.has(k.name))) errors.push("regional item in a staple kind: " + name);
    it.suggest = !(k.staple || NO_SUGGEST_KINDS.has(k.name) || (NO_SUGGEST.has(name) && !regional));
    if (regional) { it.regional = true; usedReg.add(name); }
    it.sub = subOf(k.name, name, it.cuisines || []);
    if (ITEM_MEALS[name]) { const im = ordered(sp(ITEM_MEALS[name])); if (im.join() !== subMeals(it.sub).join()) it.meals = im; usedMeals.add(name); }
    usedNo.add(name);
    return it;
  });
  const subs = (SUBDEF[k.name] || [[k.name, "", k.cuisines]]).map(([n, a, c]) => ({ name: n, aka: semi(a), cuisines: sp(c), meals: subMeals(n) }));
  const meals = MEALS.filter((m) => subs.some((sb) => sb.meals.includes(m)) || items.some((it) => (it.meals || []).includes(m)));
  for (const m of [...meals, ...subs.flatMap((sb) => sb.meals), ...items.flatMap((it) => it.meals || [])]) if (!MEALS.includes(m)) errors.push(`${k.name}: meal ${m}`);
  for (const sb of subs) if (!items.some((it) => it.sub === sb.name)) errors.push(`${k.name}: sub ${sb.name} has no items`);
  for (const it of items) if (!subs.some((sb) => sb.name === it.sub)) errors.push(`${it.name}: sub ${it.sub} not in ${k.name}`);
  out.kinds.push({ name: k.name, aka: semi(k.aka), cuisines: kc, meals, staple: k.staple, part: k.part, diet: k.diet, subs, items });
}
for (const n of NO_SUGGEST) if (!usedNo.has(n)) errors.push("NO_SUGGEST names no item: " + n);
for (const n of REGIONAL) if (!usedReg.has(n)) errors.push("REGIONAL names no item: " + n);
for (const n of Object.keys(ITEM_MEALS)) if (!usedMeals.has(n)) errors.push("ITEM_MEALS names no item: " + n);
out.notes = [
  "Owner 25 Nov: curd rice is plated as rice + curd, never a one-pot item; flavoured rices are one-pot and a plate may hold two different ones.",
  "Owner 25 Nov: onion_garlic is not a blocker: an item that has it can be made without for whoever avoids it (a note on the plate), except an item that is mostly onion.",
  "Owner 25 Nov: a family's pinned dish ('rajma every Sunday') is planned as that item on its day, not its kind; no item twice on one plate (two sabzis or two rice curries differ).",
  "Owner 25 Nov: the planner proposes only suggest:true items as new variety. suggest:false items are kept so setup recognises a family's words: same main ingredient in another shape, style, regional preparation or equipment, restaurant-style versions, ingredients a normal household doesn't keep, and every staple (a household uses its own roti and rice).",
];
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }

const fs = require("fs");
const root = process.argv[2];
fs.writeFileSync(`${root}/server/kinds.json`, JSON.stringify(out, null, 2) + "\n");

// ---------------- MARKDOWN ----------------
const GROUPS = [
  ["B", "Breakfast", "Breakfast dishes. Many also serve dinner or the tiffin box; the meals are on each heading."],
  ["S", "Lunch and dinner: staples", "These come every day their plate has them (staple: yes). The planner does not rotate them for variety."],
  ["D", "Lunch and dinner: dals and rice curries", "Dal covers every lentil and legume dal, rajma and chole included. Rice curry covers the curries eaten with rice: sambar, rasam, kuzhambu, kootu, kadhi."],
  ["V", "Lunch and dinner: vegetables", ""],
  ["R", "Lunch and dinner: rice dishes", "Khichdi, Biryani and Flavoured rice are each a whole plate on their own (with papad, raita or pickle at most); a khichdi night rotates only khichdis, a biryani lunch only biryanis, and a plate may hold two different flavoured rices. Pulao is not a whole plate: it stands where plain rice stands and needs a dal or curry beside it."],
  ["N", "Lunch and dinner: non-veg", ""],
  ["C", "Indo-Chinese and continental (eaten at home)", ""],
  ["SD", "Sides (any meal)", ""],
  ["T", "Snacks and tiffin box", ""],
  ["SW", "Sweets", ""],
];
const tagWord = { onion_garlic: "onion/garlic", white_rice: "rice", root_veg: "root veg" };
const tw = (t) => tagWord[t] || t;
let md = `# Meal Planner: dish kinds catalog

This is the review copy of \`server/kinds.json\`. Please read it as a cook would and mark anything wrong.

**A kind** is a dish family a household names when it says what is on the plate: Idli, Dosa, Poha, Roti, Dal, Sabzi, Rice, Curd. Each meal is a template of kinds: breakfast [Dosa], lunch [Rice, Dal, Sabzi, Curd], dinner [Roti, Sabzi]. A kind is never a vague slot like "breakfast dish" or "main".

**An item** is one variant of a kind: Dosa has plain dosa, masala dosa, rava dosa, set dosa; Sabzi has bhindi, aloo gobi, lauki, tinda, beans poriyal.

**How it is used.**
- *Setup*: the family's own words ("aloo sabzi", "poriyal", "pappu", "kande pohe") are matched to a kind through the kind's and items' other names (aka), so the family's plates become templates of kinds.
- *Planning*: for variety the planner picks a NEW item of the same kind for the slot (another dry vegetable for a dry vegetable), and repeats an item only when all fitting items have been used. It prefers items of the family's cuisines; an item's own cuisines narrow it further.
- *Food rules and allergies*: each item lists what it contains **as usually made in an Indian home** (contents below in brackets). Where a common version has something (peanuts in Maharashtrian poha, cashews in rava upma, garlic in tomato rasam) it is listed, so a rule is never broken by a guess. A family's own recipe can still say otherwise.

**Reading the headings**: Kind, its other names, its cuisines, its place on the plate (staple, main, side, complete = a whole plate alone, sweet, snack, drink), and the meals new items of it may be suggested at (a sub-kind or item that differs says so). A family's own dish is planned at whatever meal they eat it; at a meal outside these it stays their fixed dish and nothing new is suggested in its place. Contents shared by every item of the kind are said once on the heading line ("all: rice"); each item's brackets show the rest. A diet is shown on an item only in kinds that mix veg and non-veg.

## What we suggest

The planner proposes only items marked **Suggested** (to every family) or **Suggested in its region** (to a family whose cuisines include the item's). Items under **Recognised only** stay in the catalog so setup understands a family's words, and are planned when the family already eats them.

1. **A variant is suggested when it changes the main ingredient and needs no special equipment.** A different vegetable, lentil, flour or grain that can simply be bought counts: rava, ragi and oats idli; sattu and bajra variants; rice, ragi, wheat and corn puttu; bhindi, lauki, tinda.
2. **A regional style of a dish is suggested within its region** (\`regional: true\`, with the item's own cuisines): Chettinad or kadai chicken, macher jhol, Goan fish curry, Gujarati dal, varan, amti, cholar dal, the regional kadhis, ker sangri, haak. The family's cuisine profile is filled automatically from the cuisines of the catalog items their own dishes match, plus regions they mention, and is shown in the read-back for them to correct.
3. **A variant that changes the flavour base is suggested**: another tempering, sauce, masala, filling or topping (dal tadka and dal fry, masala khichdi, schezwan noodles, pink sauce pasta, Mysore masala or onion dosa, masala chaas, paneer butter masala, butter chicken).
4. **Recognised only = the same dish in another shape, or needing other equipment or its own plate**: thatte, mini (button) or Kanchipuram idli, sambar idli; set dosa, kal dosai, plain uttapam; lachha paratha; sandwich dhokla; the Bengali and Odia pitha shapes; tandoori chicken and chicken tikka (tandoor or oven).
5. **Staples are never suggested.** A household keeps its own roti, rice, bhakri, curd, mudde and puri: never missi roti, makki roti or brown rice.

Contents words: egg, chicken, mutton (incl. goat and lamb), pork, beef, fish, prawn (and other shellfish), onion/garlic, dairy (milk, curd, paneer, ghee, butter, cream), nuts (cashew, almond…), peanut, sugar (added sugar or jaggery), rice (rice, rice batter, poha), wheat (incl. sooji/rava, maida, pav, bread), root veg (potato, carrot, beet, yam, radish…), mushroom, brinjal, karela, coconut, soy.

**Tag families** (\`parents\` in kinds.json): chicken, mutton, pork and beef are **meat**; fish and prawn are **seafood**. Vegetarian = no meat, no seafood (egg is checked on its own). "No beef" checks beef alone; "fish but no prawn" allows fish and blocks prawn; "no meat" blocks all four meats.

`;
let total = 0;
for (const [g, title, note] of GROUPS) {
  const ks = out.kinds.filter((k, i) => kinds[i].group === g);
  md += `## ${title}\n\n`;
  if (note) md += `${note}\n\n`;
  for (const k of ks) {
    total += k.items.length;
    const shared = k.items.length > 1 ? TAGS.filter((t) => k.items.every((it) => it.contains.includes(t))) : [];
    const head = [
      k.aka.length ? `aka ${k.aka.join(", ")}` : null,
      k.cuisines.map((c) => c.replace("_", "-")).join(", "),
      k.part + (k.staple ? " (every day its plate has it)" : ""),
      k.meals.join(", "),
      k.diet === "veg" ? null : k.diet === "mixed" ? "veg and non-veg" : k.diet,
      shared.length ? `all: ${shared.map(tw).join(", ")}` : null,
    ].filter(Boolean).join("; ");
    md += `### ${k.name}\n${head}\n\n`;
    const fmt = (it) => {
      const own = it.contains.filter((t) => !shared.includes(t)).map(tw);
      const extra = [];
      if (it.diet && it.diet !== "veg") extra.push(it.diet === "nonveg" ? "non-veg" : it.diet);
      if (own.length) extra.push(own.join(", "));
      if (it.cuisines) extra.push(it.cuisines.join("/"));
      if (it.meals) extra.push(`suggested at ${it.meals.join(", ")}`);
      const aka = it.aka ? ` (${it.aka.join(", ")})` : "";
      return `${it.name}${aka}${extra.length ? ` [${extra.join("; ")}]` : ""}`;
    };
    const lines = (its) => {
      const yes = its.filter((it) => it.suggest && !it.regional), reg = its.filter((it) => it.regional), no = its.filter((it) => !it.suggest);
      if (yes.length) md += `**Suggested:** ${yes.map(fmt).join(", ")}\n\n`;
      if (reg.length) md += `**Suggested in its region:** ${reg.map(fmt).join(", ")}\n\n`;
      if (no.length) md += `**Recognised only:** ${no.map(fmt).join(", ")}\n\n`;
    };
    if (k.subs.length < 2) lines(k.items);
    else for (const sb of k.subs) {
      md += `#### ${k.name} → ${sb.name}\n${[sb.aka.length ? `aka ${sb.aka.join(", ")}` : null, sb.cuisines.join(", "), sb.meals.join() !== k.meals.join() ? `suggested at ${sb.meals.join(", ")}` : null].filter(Boolean).join("; ")}\n\n`;
      lines(k.items.filter((it) => it.sub === sb.name));
    }
  }
}
md += fs.readFileSync(`${__dirname}/decided.md`, "utf8").trimEnd() + "\n\n";
md += fs.readFileSync(`${__dirname}/open-questions.md`, "utf8");
fs.writeFileSync(`${root}/docs/kinds-catalog.md`, md);
console.log("kinds", out.kinds.length, "items", total, "suggest", out.kinds.reduce((a, k) => a + k.items.filter((i) => i.suggest).length, 0), "regional", out.kinds.reduce((a, k) => a + k.items.filter((i) => i.regional).length, 0));
