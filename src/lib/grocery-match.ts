/**
 * Exact-match grocery picker.
 *
 * One attribute schema for a recipe line and a store product title. A product is
 * only eligible when every attribute the recipe states agrees with what the
 * product states. Anything that can't be confirmed (a missing "boneless", a tray
 * with no weight, a processed food with no ingredient list under an allergy
 * shield) is never picked; it can only show up as a labelled choice for the cook.
 *
 * Order of work (rule from Kitchen + Line, Nov 7 2026):
 *   1. hard rejects: wrong aisle/category, shields (fail when in doubt), species,
 *      cut, bone, skin, frozen/canned/dried, ground, fat grade, organic,
 *      prepared/marinated, salted/unsalted, diet words, size grade.
 *   2. among exact matches, the packs that cover the scaled amount at the lowest
 *      total cost; ties go to the lower unit price, then the smaller leftover.
 *      A pack that does not cover the amount never wins.
 *   3. otherwise status "ask" with up to 3 labelled choices and no pick.
 */
import type { StapleProduct } from "./grocery-staples.ts";
import { isRelevantProduct } from "./grocery-pick.ts";

export type Form = "fresh" | "frozen" | "canned" | "dried";
export type Category = "meat" | "seafood" | "produce" | "dairy" | "eggs" | "pantry" | "nonfood" | "unknown";

export type Attrs = {
  species: string[];
  cuts: string[];
  ground: boolean;
  bone?: "boneless" | "bone-in";
  skin?: "skinless" | "skin-on";
  form?: Form;
  fat?: "extra-lean" | "lean" | "medium" | "regular";
  organic: boolean;
  /** The text says it does NOT want organic ("non-organic", "not organic", "conventional"). */
  avoidOrganic?: boolean;
  prepared: string[];
  salted?: "salted" | "unsalted";
  diet: string[];
  sizeGrade?: "small" | "medium" | "large" | "extra-large" | "jumbo";
  category: Category;
  /** Text with every attribute word removed, used for the token/head check. */
  core: string;
};

export type ShieldProfile = {
  /** AllergyId values, plus the strict egg/soy/sesame/fish shields when present. */
  allergies?: string[];
  /** PrefId diet values: vegetarian, pescatarian, vegan, gluten-free, sugar-free, dairy-free; "no-organic" excludes organic. */
  prefs?: string[];
};

export type NeedLine = { name: string; qty: number; unit: string; aisle?: string };

export type MatchProduct = StapleProduct & {
  perKgCad?: number;
  estGrams?: number;
  soldByWeight?: boolean;
  /** Store-reported unit price, normalised to $/kg, $/L or $/each. */
  unitPrice?: { cad: number; per: "kg" | "L" | "each" };
  gtin?: string;
  ingredients?: string;
  breadcrumbs?: string[];
};

export type Cover = {
  packs: number;
  totalCad: number;
  leftover: number;
  leftoverShare: number;
  byWeight: boolean;
  /** k2: set only when a multi-buy priced this cover ("5 for $3.99", or "5 for $3.99 + 1 × $1.69"). */
  deal?: string;
};

export type Verdict = {
  ok: boolean;
  /** Never shown, never picked: shields, non-food, wrong aisle, unrelated food. */
  blocked: string[];
  /** Attribute differences: shown as the label of a choice, never picked. */
  differs: string[];
  /** Product is silent on something the recipe states: shown as a choice, never picked. */
  missing: string[];
};

export type Ranked = {
  product: MatchProduct;
  cover: Cover;
  unit: { cad: number; per: "kg" | "L" | "each" } | null;
};

export type PickChoice = Ranked & { label: string; differs: string[] };

export type PickResult = {
  status: "pick" | "ask";
  pick: Ranked | null;
  /** All eligible exact matches, best first (pick is ranked[0]). */
  ranked: Ranked[];
  /** Up to 3 labelled choices when status is "ask". */
  choices: PickChoice[];
  reason: string;
  pinnedUpc?: string;
};

// ---------------------------------------------------------------------------
// Text helpers

function norm(text: string): string {
  // k2 r3: "applesauce" normalizes as "apple sauce" so title matching and prepared-form
  // checks are space-insensitive both ways (paste/sauce/puree only; "wholesome" is not "whole").
  return ` ${text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*see product description[^)]*\)/g, " marinade-options ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b([a-z]{3,})(sauce|paste|pureed|puree)\b/g, "$1 $2")} `;
}

function has(t: string, re: RegExp): boolean {
  return re.test(t);
}

const W = (words: string) => new RegExp(`(?:^| )(?:${words})(?= |$)`);

// ---------------------------------------------------------------------------
// Vocabulary

const SPECIES: { id: string; cat: "meat" | "seafood"; re: RegExp }[] = [
  { id: "chicken", cat: "meat", re: W("chicken|chickens|poultry|capon|cornish hens?") },
  { id: "turkey", cat: "meat", re: W("turkey|turkeys") },
  { id: "beef", cat: "meat", re: W("beef|hamburger|steer") },
  { id: "veal", cat: "meat", re: W("veal") },
  { id: "pork", cat: "meat", re: W("pork|ham|bacon|prosciutto|pancetta") },
  { id: "lamb", cat: "meat", re: W("lamb|mutton") },
  { id: "goat", cat: "meat", re: W("goat") },
  { id: "duck", cat: "meat", re: W("duck") },
  { id: "bison", cat: "meat", re: W("bison|buffalo meat") },
  { id: "venison", cat: "meat", re: W("venison|deer") },
  { id: "rabbit", cat: "meat", re: W("rabbit") },
  { id: "salmon", cat: "seafood", re: W("salmon") },
  { id: "cod", cat: "seafood", re: W("cod|codfish") },
  { id: "haddock", cat: "seafood", re: W("haddock") },
  { id: "halibut", cat: "seafood", re: W("halibut") },
  { id: "tuna", cat: "seafood", re: W("tuna") },
  { id: "tilapia", cat: "seafood", re: W("tilapia") },
  { id: "trout", cat: "seafood", re: W("trout") },
  { id: "pollock", cat: "seafood", re: W("pollock|pollack") },
  { id: "sole", cat: "seafood", re: W("sole") },
  { id: "basa", cat: "seafood", re: W("basa|swai") },
  { id: "mackerel", cat: "seafood", re: W("mackerel") },
  { id: "sardine", cat: "seafood", re: W("sardines?") },
  { id: "anchovy", cat: "seafood", re: W("anchov(?:y|ies)") },
  { id: "hake", cat: "seafood", re: W("hake") },
  { id: "char", cat: "seafood", re: W("arctic char|char") },
  { id: "shrimp", cat: "seafood", re: W("shrimps?|prawns?") },
  { id: "scallop", cat: "seafood", re: W("scallops?") },
  { id: "lobster", cat: "seafood", re: W("lobsters?") },
  { id: "crab", cat: "seafood", re: W("crabs?|crabmeat") },
  { id: "mussel", cat: "seafood", re: W("mussels?") },
  { id: "clam", cat: "seafood", re: W("clams?") },
  { id: "oyster", cat: "seafood", re: W("oysters?") },
];

/** Cut words; "pork chops" == "pork loin chops" is the one equivalence. */
const CUTS: { id: string; re: RegExp }[] = [
  { id: "breast", re: W("breasts?") },
  { id: "thigh", re: W("thighs?") },
  { id: "drumstick", re: W("drumsticks?") },
  { id: "wing", re: W("wings?|wingettes?|drumettes?") },
  { id: "leg", re: W("legs?|leg quarters?|back attached") },
  { id: "whole", re: W("whole (?:chicken|turkey|duck|bird|fryer|roaster|fish|salmon|trout)|roasting chicken") },
  { id: "tenderloin", re: W("tenderloins?") },
  { id: "loin", re: W("loins?|centre cut|center cut") },
  { id: "chop", re: W("chops?") },
  { id: "cutlet", re: W("cutlets?|scaloppini|schnitzel") },
  { id: "steak", re: W("steaks?") },
  { id: "roast", re: W("roasts?") },
  { id: "ribs", re: W("ribs|back ribs|side ribs|spareribs|spare ribs|short ribs?") },
  { id: "stewing", re: W("stewing|stew meat|stew beef|stewing cubes|stew cubes") },
  { id: "shoulder", re: W("shoulders?|butt|picnic|blade") },
  { id: "sirloin", re: W("sirloin") },
  { id: "striploin", re: W("striploin|strip loin|new york strip") },
  { id: "ribeye", re: W("ribeye|rib eye|prime rib") },
  { id: "round", re: W("round|eye of round|inside round|outside round") },
  { id: "brisket", re: W("brisket") },
  { id: "flank", re: W("flank|skirt") },
  { id: "chuck", re: W("chuck") },
  { id: "shank", re: W("shanks?|hocks?|osso buco") },
  { id: "belly", re: W("belly") },
  { id: "rack", re: W("rack|frenched") },
  { id: "fillet", re: W("fillets?|filets?|portions?") },
  { id: "strips", re: W("strips|stir fry strips|stir fry") },
  { id: "kabob", re: W("kabobs?|kebabs?|skewers?") },
];

/** Product words that make it a different, prepared or processed food. */
const PREPARED: { id: string; re: RegExp }[] = [
  { id: "marinated", re: W("marinated|marinade|buttermilk|pesto|hollandaise|miso|maple|glazed|glaze|marinade options|teriyaki|souvlaki|tikka|satay|shawarma|bulgogi|jerk|bbq|barbecue|barbeque|honey garlic|lemon pepper|piri piri|peri peri") },
  { id: "seasoned", re: W("seasoned|seasoning|flavoured|flavored|herb|herbed|spiced|rub") },
  { id: "breaded", re: W("breaded|battered|crusted|crispy|crunch|popcorn|nuggets?|tenders|fingers|panko coated|southern style|fried|kiev|cordon bleu") },
  { id: "cooked", re: W("cooked|fully cooked|precooked|pre cooked|roasted|rotisserie|grilled|ready to eat|ready to serve") },
  { id: "smoked", re: W("smoked|cured|lox|kippered|candied") },
  { id: "stuffed", re: W("stuffed|wrapped|bacon wrapped") },
  { id: "spicy", re: W("spicy|hot|buffalo|nashville|cajun|szechuan|general tao|sriracha|chipotle") },
  { id: "burger", re: W("burgers?|sliders?|patty|patties|meatballs?|sausages?|hot dogs?|wieners?|smokies|bratwurst|chorizo") },
  { id: "deli", re: W("deli|shaved|lunch meat|cold cuts?|slices|natural selections") },
  { id: "meal", re: W("meal|meals|entree|dinner kit|meal kit|kit|bowl|skillet|stir fry kit|pizza|pie|sandwich|wrap|burrito|lasagna|alfredo|butter chicken|curry|bake|casserole|pot pie|gumbo|chowder") },
  { id: "sauce", re: W("sauce|gravy|dip|dressing|salsa") },
  { id: "soup", re: W("soup|broth|stock|bouillon|consomme|base") },
  { id: "snack", re: W("chips|crackers|jerky|bar|bars|bites|snack|snacks|candy|chocolate") },
  { id: "plant", re: W("plant based|plant|vegan|meatless|veggie|beyond meat|impossible") },
  { id: "instant", re: W("instant|quick cook|quick cooking|minute|parboiled|converted|boil in bag|ready rice|microwavable|microwaveable|cup noodles?") },
  { id: "with extras", re: W("with|in tomato sauce|in sauce|w") },
  { id: "concentrated", re: W("concentrated|condensed|concentrate|bouillon cubes?|base") },
];

const NONFOOD = W("dog|dogs|cat|cats|pet|pets|kitten|puppy|treats|litter|shampoo|soap|detergent|toy|toys|candle|candles|air freshener|cleaner");

const DIET_WORDS: { id: string; re: RegExp }[] = [
  { id: "gluten-free", re: W("gluten free|gf|sans gluten") },
  { id: "dairy-free", re: W("dairy free|lactose free|non dairy") },
  { id: "sugar-free", re: W("sugar free|no sugar added|unsweetened") },
  { id: "low-sodium", re: W("low sodium|reduced sodium|less salt|no salt added|sodium free") },
  { id: "fat-free", re: W("fat free|skim|0%") },
  { id: "halal", re: W("halal|zabiha|zabeeha") },
  { id: "kosher", re: W("kosher(?! salt)") },
];

const PRODUCE = W(
  "onions?|garlic|potato(?:es)?|carrots?|celery|lemons?|limes?|apples?|bananas?|tomato(?:es)?|peppers?|spinach|lettuce|kale|cabbage|broccoli|cauliflower|mushrooms?|zucchini|cucumbers?|ginger|cilantro|parsley|basil|thyme|rosemary|dill|mint|scallions?|leeks?|shallots?|squash|pumpkin|corn|peas|beans|berries|strawberries|blueberries|raspberries|oranges?|avocados?|sweet potato(?:es)?|beets?|radish(?:es)?|turnips?|parsnips?|asparagus|eggplant|herbs?",
);
const DAIRY = W("milk|butter|cream|cheese|cheddar|mozzarella|parmesan|yogurt|yoghurt|sour cream|ricotta|feta|kefir|ghee");
const EGGS = W("eggs?");

/** Prep words on a recipe line: never required of a product. */
const PREP = W(
  "chopped|minced|sliced|diced|cubed|grated|shredded|peeled|crushed|julienned|melted|softened|beaten|divided|optional|packed|sifted|trimmed|halved|quartered|thinly|finely|coarsely|roughly|freshly|room temperature|to taste|for serving|for garnish|cut into pieces",
);

// ---------------------------------------------------------------------------
// Parse

export function parseAttrs(text: string): Attrs {
  const t = norm(text);
  const species = SPECIES.filter((s) => s.re.test(t)).map((s) => s.id);
  const sp = [...new Set(species)];
  // Beef-only cut names imply beef when the line doesn't say the animal.
  if (!sp.length && has(t, W("sirloin|striploin|strip loin|ribeye|rib eye|prime rib|brisket|chuck|flank|skirt steak|short ribs?|t bone|porterhouse|eye of round|tri tip|oxtail"))) sp.push("beef");
  const isMeat = sp.length > 0;
  const cuts = isMeat ? CUTS.filter((c) => c.re.test(t)).map((c) => c.id) : [];
  // Breadcrumb-free hint: "stew" alone is a dish, "stewing" is the cut (handled in CUTS).
  const ground = isMeat && has(t, W("ground|minced|mince|hamburger|lean ground|burger meat"));
  let bone: Attrs["bone"];
  if (has(t, W("boneless|deboned|bone less|bnls"))) bone = "boneless";
  else if (has(t, W("bone in|bone on|bonein|back attached|with bone"))) bone = "bone-in";
  let skin: Attrs["skin"];
  if (has(t, W("skinless|skin off|skinned|no skin"))) skin = "skinless";
  else if (has(t, W("skin on|with skin|skinon"))) skin = "skin-on";
  if (ground) {
    bone = bone ?? "boneless";
    skin = skin ?? "skinless";
  }
  let form: Form | undefined;
  if (has(t, W("frozen|iqf|flash frozen|previously frozen|thawed|individually quick frozen"))) form = "frozen";
  else if (has(t, W("canned|can|cans|tin|tinned|in water|in oil|in brine"))) form = "canned";
  else if (has(t, W("dried|dehydrated|freeze dried|sun dried"))) form = "dried";
  else if (has(t, W("fresh"))) form = "fresh";
  let fat: Attrs["fat"];
  if (has(t, W("extra lean|xtra lean|extra lean ground"))) fat = "extra-lean";
  else if (has(t, W("lean"))) fat = "lean";
  else if (has(t, W("medium"))) fat = "medium";
  else if (has(t, W("regular"))) fat = "regular";
  const avoidOrganic = has(t, W("non organic|not organic|no organic|nonorganic|inorganic|conventional|conventionally grown"));
  const organic = !avoidOrganic && has(t, W("organic|organics|biologique"));
  const prepared = PREPARED.filter((p) => p.re.test(t)).map((p) => p.id);
  let salted: Attrs["salted"];
  if (has(t, W("unsalted|no salt added|sweet cream unsalted"))) salted = "unsalted";
  else if (has(t, W("salted"))) salted = "salted";
  const diet = DIET_WORDS.filter((d) => d.re.test(t)).map((d) => d.id);
  let sizeGrade: Attrs["sizeGrade"];
  if (has(t, W("jumbo"))) sizeGrade = "jumbo";
  else if (has(t, W("extra large|xl"))) sizeGrade = "extra-large";
  else if (has(t, W("large"))) sizeGrade = "large";
  else if (has(t, W("medium"))) sizeGrade = "medium";
  else if (has(t, W("small"))) sizeGrade = "small";
  let category: Category = "unknown";
  const processed = prepared.some((p) => ["soup", "sauce", "snack", "meal", "burger", "deli"].includes(p));
  if (NONFOOD.test(t)) category = "nonfood";
  else if (processed) category = "pantry";
  else if (sp.some((s) => SPECIES.find((x) => x.id === s)?.cat === "meat")) category = "meat";
  else if (sp.length) category = "seafood";
  else if (EGGS.test(t) && !has(t, W("noodles?|eggplant|nog|eggnog|salad|chocolate|mini eggs|candy"))) category = "eggs";
  else if (DAIRY.test(t)) category = "dairy";
  else if (PRODUCE.test(t)) category = "produce";
  else category = "pantry";
  const core = coreText(t);
  return {
    species: sp,
    cuts,
    ground,
    bone,
    skin,
    form,
    fat: ground || category !== "meat" ? fat : undefined,
    organic,
    avoidOrganic: avoidOrganic || undefined,
    prepared,
    salted,
    diet,
    sizeGrade: category === "eggs" ? sizeGrade : undefined,
    category,
    core,
  };
}

const ATTR_WORDS = W(
  "fresh|frozen|iqf|flash frozen|previously frozen|thawed|canned|can|cans|tin|tinned|dried|dehydrated|boneless|bone in|bone on|skinless|skin on|skin off|lean|extra lean|medium|regular|non organic|not organic|no organic|conventional|conventionally grown|organic|organics|unsalted|salted|gluten free|gf|dairy free|lactose free|sugar free|low sodium|reduced sodium|no salt added|halal|zabiha|zabeeha|club pack|value pack|family pack|family size|jumbo pack|large|small|extra large|xl|jumbo|raw|uncooked|natural|premium|select|grade a|aaa|aa|free range|free run|grain fed|air chilled|no antibiotics|raised without antibiotics|free from|new|fancy|packaged|tray pack|tray|club size|club|cubes|chunks|pieces|portions|wild|farmed|sustainably sourced|deluxe|halal|zabiha|value|pack|size|plant based|plant|vegan|dairy free|non dairy",
);

function coreText(t: string): string {
  // Printed sizes ("28 fl oz", "28 us fl oz", "28 fluid ounces", "796 ml") are amounts, not product words.
  let out = t.replace(/ \d+(?: \d+)? (?:(?:us|imperial|imp) )?(?:fl oz|fluid ounces?|fl ounces?|ounces?|oz|ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|g|grams?|kg|lbs?)(?= )/g, " ");
  for (let i = 0; i < 3; i++) out = out.replace(ATTR_WORDS, " ").replace(PREP, " ");
  return out.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Shields: product text against the cook's allergies and diet. Fail when in doubt.

// Each pattern is anchored at word starts and carries its known lookalikes:
// eggplant isn't egg, coconut milk / peanut butter / cocoa butter aren't dairy,
// buckwheat isn't wheat, scalloped potatoes aren't scallops, and so on.
const SHIELD_RE: Record<string, RegExp> = {
  gluten: /(?<!buck)wheat|\bflour|\bbarley|\brye\b|\bmalt(?!odextrin|ose|itol)|\boats?\b|\bspelt\b|\bsemolina|\bdurum|\bbread(?!fruit)|\bcrumbs?\b|\bpanko|\bpasta|(?<!rice |glass |shirataki |kelp |bean |sweet potato |konjac )\bnoodles?|\bcouscous|\bseitan|soy sauce|teriyaki|\bbatter\b|\bbattered|\bbreaded|\bgraham|\bcrackers?\b|\bbiscuits?\b|\bbran\b|triticale|\bkamut|\bfarro|\bbulgur|brewer|\bbeer\b|\bgluten(?![- ]free)/i,
  dairy: /\bmilk|\bbutter(?!nut|scotch flavou?r| beans?| lettuce)|\bcream(?! of tartar)|\bcheeses?\b|cheddar|mozzarella|parmesan|\byogh?urt|\bwhey|\bcasein|caseinate|\blactose(?![- ]free)|\bghee|\bkefir|sour cream|\bcurds?\b|\bdairy\b/i,
  nuts: /\bpeanuts?|\balmonds?|\bwalnuts?|\bpecans?|\bcashews?|\bpistachios?|\bhazelnuts?|\bfilberts?|\bmacadamia|\bpine nuts?|\bbrazil nuts?|\bpralines?|\bmarzipan|\bnougat|\bgianduja|\btree nuts?\b|\bnuts?\b|(?<!water )\bchestnuts?\b/i,
  shellfish: /\bshrimps?\b|\bprawns?\b|\bcrabs?\b(?!apple)|\bcrab meat|\blobsters?\b|\bclams?\b|\bclamato|\bmussels?\b|\bscallops?\b|\boysters?\b(?! mushrooms?)|\bcrawfish|\bcrayfish|\bkrill|\blangoustines?|\bshellfish|\bcrustaceans?|\bmolluscs?|\bmollusks?/i,
  spicy: /\bchil(?:i|e|li)(?!an)\b|\bchil(?:i|e|li)s\b|cayenne|jalape[nñ]o|hot sauce|pepper flakes?|harissa|sriracha|gochujang|chipotle|habanero|scotch bonnet|\bspicy|\bhot\b|\bbuffalo|\bcajun|\bjerk\b|\bcurry|szechuan|piri piri|peri peri/i,
  egg: /\beggs?\b|\begg (?:yolks?|whites?|powder|solids|product|noodles?|wash)|\beggnog|\byolks?\b|\balbumin|\balbumen|mayonnaise|\bmayo\b|meringue|lysozyme|\bovo(?:mucoid|mucin|globulin|transferrin|vitellin|albumin)/i,
  soy: /\bsoy(?:a|bean|beans)?\b|\btofu|\bedamame|\bmiso\b|\btempeh|\btamari|\bshoyu|teriyaki|(?<!sunflower |canola |rapeseed |egg )lecithin|vegetable oil|hydrolyzed (?:vegetable|plant|soy) protein|textured vegetable protein/i,
  sesame: /\bsesame|\btahini|\bhalvah?\b|\bgomasio|\bbenne\b|\bza'?atar/i,
  fish: /\bfish\b(?! shaped)|\bfish (?:sauce|oil|gelatin|stock)|\bsalmon\b|\bcod\b|\bhaddock|\bhalibut|\btuna\b|\btilapia|\btrout\b|\bpollock|\bsole\b|\bbasa\b|\bmackerel|\bsardines?|\banchov|\bhake\b|\bchar\b|\bherring|\broe\b|\bcaviar|worcestershire|\bcaesar|\bbonito|\bdashi\b|omega[- ]?3 \(fish/i,
};

/** Generic words a precautionary sentence uses for each allergen ("may contain nuts", "traces of milk"). */
const SHIELD_NAMES: Record<string, RegExp> = {
  gluten: /\bgluten\b|\bwheat\b|\bcereals? containing gluten/i,
  dairy: /\bmilk\b|\bdairy\b|\blactose\b/i,
  nuts: /\bnuts?\b|\btree ?nuts?\b|\bpeanuts?\b/i,
  shellfish: /\bshellfish\b|\bcrustaceans?\b|\bmolluscs?\b|\bmollusks?\b/i,
  egg: /\beggs?\b/i,
  soy: /\bsoy(?:a|bean)?\b/i,
  sesame: /\bsesame\b|\bseeds\b/i,
  fish: /\bfish\b/i,
  spicy: /$^/,
};

/** A "may contain" / "traces of" / "made in a facility with" sentence. */
const PRECAUTION = /may contain|may also contain|\btraces?\b|processed (?:in|on)|manufactured (?:in|on)|made (?:in|on)|produced (?:in|on)|packaged (?:in|on)|prepared (?:in|on)|facility|\bplant that\b|same (?:equipment|line)|shared (?:equipment|line)|cross[- ]contact|cross[- ]contamination/i;

/** "nut-free", "egg free", "dairy-free"...: a claim, not an ingredient. Removed before testing. */
const FREE_CLAIM = /\b(?:gluten|wheat|dairy|milk|lactose|nut|peanut|tree nut|egg|soy|sesame|fish|shellfish)s?[- ]free\b|\bnon[- ]dairy\b/gi;

/**
 * Plant foods that borrow a dairy/meat word. Removed before the dairy, vegan and
 * vegetarian tests; the rest of the text (ingredients) is still checked.
 */
const PLANT_LOOKALIKE = /\b(?:coconut|almond|oat|soy|soya|rice|cashew|hemp|pea|macadamia|hazelnut|plant|plant[- ]based|vegan|non[- ]dairy|peanut|nut|seed|sunflower|sunflower seed|pumpkin seed|cocoa|cacao|shea|apple|pumpkin|sesame)s? (?:milk|beverage|butter|cream|creamer|cheese|yogh?urt|spread)\b|\bbutter (?:beans?|lettuce|nut squash)\b|\bbutternut\b|\bcream of tartar\b|\bcream style corn\b|\bcreamed corn\b|\bmilk thistle\b/gi;

const MEAT_LOOKALIKE = /\b(?:plant[- ]based|vegan|veggie|vegetarian|meatless|meat[- ]free|beyond|impossible|soy|tofu)\s+(?:meat|chicken|beef|pork|sausages?|bacon|ham|turkey|burgers?|ground)\b|\b(?:vegetable|veggie|mushroom|garden|plant[- ]based|vegan|no[- ]chicken|not[- ]chicken|vegetarian)\s+(?:broth|stock|bouillon|base)\b|\bmeatless\b|\bmeat[- ]free\b|\bbeefsteak tomato(?:es)?\b|\bgoat(?:'s)? (?:milk|cheese)\b|\bduck sauce\b|\bmincemeat\b(?= .*\bvegetable suet\b)|\b(?:crab|fish|shellfish)[- ]?meats?\b/gi;

const MEAT_RE = /\bchicken|\bbeef\b|\bpork\b|\blamb\b|\bturkey\b|\bveal\b|\bduck\b|\bgoat\b|\bbison\b|\bvenison|\brabbit|\bham\b|\bhams\b|\bbacon|prosciutto|pancetta|\bsausages?|pepperoni|salami|\bgelatine?\b|\blard\b|\btallow|\bsuet\b|\banchov|\bmeat\b|\bmeats\b|\bbroth|\bstock\b|\bbouillon|\brennet\b|\bcarmine\b/i;
const SEAFOOD_RE = new RegExp(`${SHIELD_RE.fish!.source}|${SHIELD_RE.shellfish!.source}`, "i");
const SUGAR_RE = /\bsugar(?![- ]free| snap)|\bsyrup|\bhoney(?!dew|crisp)|\bmolasses|\bdextrose|\bglucose|\bfructose|\bsucrose|maltodextrin|\bsweetened(?! ?with)|\bcandied|cane juice|\bagave/i;
const VEGAN_ANIMAL = /\bhoney(?!dew|crisp)|\bbeeswax|\bcarmine|\bshellac|\bgelatine?\b|\bisinglass|\blanolin|\bcochineal|\bconfectioner'?s glaze/i;

/** Sentences of an ingredient panel. */
function sentences(text: string): string[] {
  return text.split(/[.;\n]+|\s(?=contains:)/i).map((x) => x.trim()).filter(Boolean);
}

/** A precautionary sentence that names the allergen anywhere in it. */
function precautionHit(id: string, ingredients: string): boolean {
  const names = SHIELD_NAMES[id];
  const re = SHIELD_RE[id];
  if (!ingredients || (!names && !re)) return false;
  return sentences(ingredients.replace(FREE_CLAIM, " ")).some((sentence) => {
    if (!PRECAUTION.test(sentence)) return false;
    // "Made in a facility free from peanuts" is a claim; "may contain" / "traces" in the same sentence still wins.
    if (/\bfree (?:of|from)\b/i.test(sentence) && !/may (?:also )?contain|\btraces?\b/i.test(sentence)) return false;
    return (names?.test(sentence) ?? false) || (re?.test(sentence) ?? false);
  });
}

/**
 * A made product (paste, sauce, puree, …) is never a single-ingredient whole food,
 * regardless of a meat / seafood / produce category. Checked on the raw title, the
 * safety-split title (suffix / joined tail), and a squashed form. "mixed greens" is not a "mix".
 * k3 also counts crabmeat / crab meat, crab stick(s), imitation, surimi, flavoured/flavored, and "style".
 */
const MADE_PRODUCT_WORD = /\b(?:pastes?|sauces?|purees?|pureed|spreads?|dips?|mixes?|seasonings?|stocks?|broths?|soups?|dressings?|marinades?|pestos?|relishes?|salsas?|chutneys?|ketchups?|crab\s*meats?|crab\s*sticks?|imitation|surimi|flavou?red|styles?)\b/i;
const MADE_PRODUCT_SQUASH = /(?:paste|sauce|puree|pureed|spread|dip|mix|seasoning|stock|broth|soup|dressing|marinade|pesto|relish|salsa|chutney|ketchup|crabmeat|crabstick|imitation|surimi|flavoured|flavored|style)s?$/i;

export function squashedText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Split a title only at a made-product suffix / joined tail ("shrimppaste" → "shrimp paste"). */
const MADE_SUFFIX = "sauces?|pastes?|pureed|purees?|spreads?|dips?|mixes?|mix|seasonings?|stocks?|broths?|soups?|dressings?|marinades?|pestos?|relishes?|salsas?|chutneys?|ketchups?|sticks?";

// Joined gluten food suffixes split so SHIELD_RE sees the same words as the spaced form
// on r4 / caa0398. Lookalikes stay unsplit: buckwheat (wheat), cauliflower (flour),
// breadfruit (bread), sweetbread(s) (organ meat, not a baked bread).
const GLUTEN_FOOD_SUFFIX = "noodles?|crackers?|breads?|buns?|rolls?|wraps?|pasta|bagels?|pitas?|cakes?|cookies?|biscuits?|pretzels?|croutons?|flour|wheat";
const GLUTEN_JOIN_LOOKALIKE = new Set([
  "buckwheat", "cauliflower", "cauliflowers", "breadfruit", "breadfruits", "sweetbread", "sweetbreads",
]);

export function splitGlutenFoodWords(text: string): string {
  if (!text) return text;
  const re = new RegExp(`\\b([a-z]{3,})(${GLUTEN_FOOD_SUFFIX})\\b`, "gi");
  return text.replace(re, (all, head, suf) => {
    const joined = `${head}${suf}`.toLowerCase();
    if (GLUTEN_JOIN_LOOKALIKE.has(joined)) return all;
    return `${head} ${suf}`;
  });
}

export function safetySplitTitle(title: string): string {
  const t = splitGlutenFoodWords(
    title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9%]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(new RegExp(`\\b([a-z]{3,})(${MADE_SUFFIX})\\b`, "g"), "$1 $2")
      .replace(/\bcrabmeat(s)?\b/g, "crab meat$1"),
  );
  return ` ${t} `;
}

export function isMadeProductTitle(title: string): boolean {
  const stripped = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (MADE_PRODUCT_WORD.test(stripped)) return true;
  if (MADE_PRODUCT_WORD.test(safetySplitTitle(title))) return true;
  const squash = squashedText(stripped);
  if (/lifestyle$/.test(squash)) return false;
  return MADE_PRODUCT_SQUASH.test(squash);
}


/**
 * k3 r2: a list is real only if, after removing allergen statements and package-referral
 * sentences, the remainder has at least two comma- or semicolon-separated items, and at
 * least one item contains a recognized English or French food word. Placeholder words
 * never void a real list by substring; only a whole segment can be a placeholder.
 */
const PACKAGE_REFERRAL =
  /^(?:(?:please\s+)?(?:see|refer(?:\s+to)?|voir|consulter)\b.{0,100}\b(?:package|packaging|label|emballage|etiquette)|product packaging for most accurate|(?:ingredients?|information)\s+not\s+(?:listed|provided)|not listed|no information|information not provided|non disponibles?|coming soon|please refer to the product label|refer to packag(?:e|ing)|refer to the product label|see product packaging|ingredients? unavailable|ingredients not listed)/i;
const ALLERGEN_STATEMENT =
  /^(?:may (?:also )?contain\b|contains?\s*:|contains none of the priority allergens|none of the priority allergens|traces of\b|allergy advice\b|(?:produced|manufactured|made|processed|packed|packaged) in (?:a )?(?:facility|plant|factory|bakery)\b|not suitable for\b|warning\s*:)/i;
const WHOLE_SEGMENT_PLACEHOLDER =
  /^(?:—|–|-{1,2}|\.{2,}|…|\?|0|n\/?a|n\.a\.|na|none|nil|tbd|tba|null|undefined|pending|unknown|unavailable|varies|various|unlisted)$/i;

/** English + French ingredient lexicon for "does this look like a real list?". */
const FOOD_WORD_SRC = `
  water salt sugar sugars flour oil oils milk butter cream cheese egg eggs yolk yolks
  tomato tomatoes onion onions garlic pepper peppers chicken beef pork wheat yeast vinegar
  extract starch protein juice rice corn oat oats barley rye soy soya soybean soybeans
  peanut peanuts almond almonds cashew cashews walnut walnuts sesame tahini basil olive
  olives canola sunflower palm coconut potato potatoes carrot carrots celery parsley cilantro
  lime lemon spice spices herb herbs paprika cumin chili chilli cider honey maple molasses
  gelatin gelatine culture enzyme cocoa chocolate vanilla flavour flavor color colour citric
  ascorbic acid phosphate calcium potassium magnesium lecithin gum pectin malt dextrose
  fructose glucose sucrose syrup invert modified hydrogenated vegetable vegetables fruit
  fruits berry berries apple apples orange grape banana mango pineapple peach pear cherry
  strawberry blueberry raspberry cranberry raisin raisins date dates fig figs ginger turmeric
  cinnamon nutmeg clove cloves mustard horseradish mayo mayonnaise ketchup relish pickle
  pickles cucumber lettuce spinach kale cabbage broccoli cauliflower pea peas bean beans
  lentil lentils chickpea chickpeas hummus tofu tempeh miso edamame noodle noodles pasta
  bread breadcrumb breadcrumbs crumb crumbs cracker crackers bun buns dough batter coating
  fillet fillets steak steaks chop loin breast thigh wing wings rib ribs bacon ham sausage
  turkey lamb duck veal fish salmon tuna cod haddock shrimp prawn crab lobster clam mussel
  oyster scallop anchovy sardine trout tilapia pollock surimi imitation meat meats stock
  broth bouillon dashi bonito worcestershire tamari shoyu teriyaki semolina durum graham
  panko buttermilk whey casein ghee yogurt yoghurt mozzarella cheddar parmesan sour
  sodium nitrite nitrate bicarbonate baking soda powder onion garlic
  eau sel sucre sucres farine huile huiles lait beurre creme fromage oeuf oeufs jaune
  tomate tomates oignon oignons ail poivre poulet boeuf porc ble levure vinaigre extrait
  amidon proteine jus riz mais avoine orge seigle soja soya arachide arachides amande
  amandes noix noisette noisettes sesame basilic olive olives tournesol palme coco
  pomme pommes terre carotte carottes celeri persil coriandre citron epice epices herbe
  herbes miel sirop gelatine culture enzyme cacao chocolat vanille arome naturel colorant
  acide citrique ascorbique phosphate calcium potassium lecithine gomme pectine fructose
  glucose vegetale vegetal legumes fruit fruits orange raisin banane mangue ananas peche
  poire cerise fraise framboise canneberge datte figue gingembre curcuma cannelle muscade
  moutarde mayonnaise ketchup cornichon concombre laitue epinard chou brocoli pois haricot
  haricots lentille lentilles tofu tempeh miso nouille nouilles pates pain chapelure
  filet filets steak poitrine cuisse lard jambon saucisse dinde agneau canard veau
  poisson saumon thon morue crevette crevettes crabe homard palourde moule huitre
  petoncle anchois sardine truite viande bouillon sauce pate concentre semoule feves
  feve dur tapioca amidon eau filtree biologiques biologique canne
  catfish swordfish whitefish monkfish kingfish bluefish lingcod blackcod
  codfish tunafish rockfish redfish snowcrab kingcrab crawfish crayfish
  shellfish lobstertail lobstertails crabmeat pollock tilapia halibut
  eggplant eggplants mushroom mushrooms aubergine champignon champignons
  buckwheat groats quinoa millet sorghum teff amaranth kasha farro spelt kamut couscous bulgur polenta grits oatmeal granola sarrasin
  bass seabass snapper grouper mackerel herring flounder sole perch pike walleye char steelhead mahi hake turbot brill skate roe
`;
const FOOD_WORDS = new Set(FOOD_WORD_SRC.split(/\s+/).filter((w) => w.length >= 3));

const MADE_OR_FOOD_CONTINUATION = new Set([
  ...FOOD_WORDS,
  "paste", "pastes", "sauce", "sauces", "puree", "purees", "pureed", "spread", "spreads",
  "dip", "dips", "mix", "mixes", "seasoning", "seasonings", "stock", "stocks", "broth",
  "broths", "soup", "soups", "dressing", "dressings", "marinade", "marinades", "pesto",
  "pestos", "relish", "relishes", "salsa", "salsas", "chutney", "chutneys", "ketchup",
  "ketchups", "meat", "meats", "stick", "sticks", "cake", "cakes", "cracker", "crackers",
  "noodle", "noodles", "milk", "butter", "oil", "flour", "bread", "fillet", "fillets",
  "tail", "tails", "fish", "nog", "white", "yolk", "yolks", "bean", "beans",
]);

/**
 * Lookalike exclusions for joined-stem matching (documented in k3 r2 NOTES).
 * fryer/fryers: "rye" is not a stem here; listed because it was an r4 substring false hit.
 * brandywine: same, "bran" substring.
 * veggie/veggies, reggiano: "egg" substring.
 * gallo: "cod" substring (Pico de Gallo).
 * fortuna: "tuna" substring.
 * eggplant(s): egg + plant, but it is produce, not egg.
 * crabapple(s): crab prefix + apple, but it is fruit, not shellfish.
 * codes, codeine, codec, codex, coda: "cod" prefix, rest is not a food word; listed explicitly.
 * goldfish: fish suffix, but a cracker brand, not fish meat.
 * starfish, fishmonger, fishbowl, fishhook, fishtank, fisherman, fisher, fishing: fish suffix, not food.
 * lifestyle: "style" made-product suffix, not a made food.
 * shellfish, crayfish, crawfish: …fish suffix is mapped to shellfish, not fish.
 */
const STEM_LOOKALIKE: Record<string, Set<string>> = {
  egg: new Set(["eggplant", "eggplants", "veggie", "veggies", "reggiano"]),
  shellfish: new Set(["crabapple", "crabapples", "oystermushroom", "oystermushrooms"]),
  fish: new Set(["fortuna", "gallo", "goldfish", "starfish", "fishmonger", "fishbowl", "fishhook", "fishtank", "fisherman", "fisher", "fishing", "fishnet", "fishnets"]),
  gluten: new Set(["fryer", "fryers", "brandywine", "buckwheat"]),
  soy: new Set(),
  dairy: new Set(["buttercup", "buttercups", "butternut", "butternuts", "butterbean", "butterbeans", "creamery", "creameries", "milkweed", "milkweeds"]),
  nuts: new Set(),
  sesame: new Set(),
  spicy: new Set(),
};
const COD_LOOKALIKE = new Set(["codes", "codeine", "codec", "codex", "coda", "coddle", "coddled"]);
const FISH_AS_SHELLFISH = new Set(["shellfish", "crayfish", "crawfish"]);

function foldScan(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/œ/gi, "oe")
    .replace(/æ/gi, "ae")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/-/g, " ");
}

function scanTokens(text: string): string[] {
  return foldScan(text).match(/[a-z]{2,}/g) ?? [];
}

const PREFIX_STEMS: Record<string, string[]> = {
  shellfish: ["shrimp", "shrimps", "crab", "crabs", "oyster", "oysters", "prawn", "prawns", "lobster", "lobsters", "clam", "clams", "mussel", "mussels", "scallop", "scallops"],
  fish: ["tuna", "fish", "cod", "salmon", "anchov", "haddock", "trout", "pollock"],
  egg: ["egg"],
  soy: ["soy", "soya"],
  dairy: ["milk", "butter", "cheese", "cream", "whey"],
  nuts: ["peanut", "almond", "walnut", "cashew", "pecan", "hazelnut"],
  gluten: ["wheat", "flour", "barley", "rye", "oat"],
  sesame: ["sesame"],
};

const SUFFIX_SHELLFISH = /(crab|shrimp|prawn|lobster|oyster|lobstertail)s?$/;
const SUFFIX_FISH = /(fish|cod)$/;
// Bare stems ("oyster", "fish", "cod") belong to SHIELD_RE so lookalikes like
// "oyster mushroom" keep the existing word-boundary + negative-lookahead rules.
const BARE_SHELLFISH_SUFFIX = new Set(["crab", "crabs", "shrimp", "shrimps", "prawn", "prawns", "lobster", "lobsters", "oyster", "oysters", "lobstertail", "lobstertails"]);
const BARE_FISH_SUFFIX = new Set(["fish", "cod"]);

function isLookalike(id: string, token: string): boolean {
  if (STEM_LOOKALIKE[id]?.has(token)) return true;
  if ((id === "fish" || PREFIX_STEMS.fish?.some((s) => token.startsWith(s))) && COD_LOOKALIKE.has(token)) return true;
  return false;
}

/** Joined-word / allergen-stem hits on a title or a list. Add-only. */
export function stemHits(id: string, text: string): boolean {
  if (!text) return false;
  const tokens = scanTokens(text);
  for (const tok of tokens) {
    if (isLookalike(id, tok)) continue;
    if (id === "fish" && FISH_AS_SHELLFISH.has(tok)) continue;
    if (id === "shellfish" && FISH_AS_SHELLFISH.has(tok)) return true;
    if (id === "shellfish" && SUFFIX_SHELLFISH.test(tok) && !BARE_SHELLFISH_SUFFIX.has(tok)) return true;
    if (id === "fish" && SUFFIX_FISH.test(tok) && !BARE_FISH_SUFFIX.has(tok) && !FISH_AS_SHELLFISH.has(tok)) return true;
    for (const stem of PREFIX_STEMS[id] ?? []) {
      if (tok === stem) continue; // whole-word hits belong to SHIELD_RE
      if (tok.startsWith(stem) && tok.length > stem.length) {
        const rest = tok.slice(stem.length);
        if (isLookalike(id, tok)) continue;
        if (id === "fish" && COD_LOOKALIKE.has(tok)) continue;
        if (STEM_LOOKALIKE[id]?.has(tok)) continue;
        // Rest is a food/made-product word, or any letter tail of length >= 3
        // (Eggrolls, Cheeseburger, Lobsterbisque, Soymilk, Fishsauce). Lookalikes
        // already skipped, so fryer/gallo/veggie/fortuna mid-word false hits stay out.
        if (MADE_OR_FOOD_CONTINUATION.has(rest) || (rest.length >= 3 && /^[a-z]+$/.test(rest))) return true;
      }
    }
  }
  return false;
}

// Dairy-only plant lookalikes (Canadian bilingual labels). These phrases are
// stripped ONLY for the dairy check. Nuts, soy, gluten, sesame and every other
// check read the original text (so "lait d'amande" / "beurre de cajou" still
// refuse nuts).
const FR_DAIRY_PLANT_LOOKALIKE =
  /(?:lait|creme|beurre|fromage|yog(?:hourt|ourt)?)\s+(?:de\s+|d\s+)?(?:coco|amande|amandes|avoine|soja|soya|riz|cajou|pois)|noix\s+de\s+coco/gi;
// Nuts-only coconut lookalikes: "noix" in "noix de coco" is coconut, not a tree nut.
// "lait/crème de coco" have no nut stem after folding, but are listed so the notes
// match the code exactly.
const FR_NUT_COCONUT_LOOKALIKE =
  /noix\s+de\s+coco|(?:lait|creme)\s+(?:de\s+|d\s+)?coco/gi;

const FR_SHIELD: Record<string, RegExp> = {
  shellfish: /\b(?:crevettes?|crabes?|homards?|huitres?|palourdes?|moules?|petoncles?|mollusques?|crustaces?|fruits de mer)\b/i,
  fish: /\b(?:morue|thon|poisson|saumon|anchois|truite|sardines?|eglefin|aiglefin|fletan|merlu|hareng|maquereau)\b/i,
  egg: /\b(?:oeufs?|jaunes?)\b/i,
  gluten: /\b(?:ble|seigle|orge|froment|epeautre|avoine)\b/i,
  soy: /\b(?:soja|soya)\b/i,
  dairy: /\b(?:lait|beurre|fromage|creme|yaourt|yogourt|yoghourt|ghee)\b/i,
  nuts: /\b(?:arachides?|noix|amandes?|noisettes?|cajou|pacanes?|pistaches?)\b/i,
  sesame: /\b(?:sesame|tahini)\b/i,
};

const FR_MEAT = /\b(?:poulet|boeuf|porc|dinde|jambon|lard|saucisse|viande|agneau|veau|canard|bacon|dindon)\b/i;
const PREFIX_MEAT = ["chicken", "beef", "pork", "turkey", "lamb", "veal", "duck", "goat", "bison", "venison", "bacon", "ham", "sausage", "pepperoni", "salami", "jerky", "prosciutto", "pancetta"];
const MEAT_STEM_LOOKALIKE = new Set(["hammer", "hammers", "hamster", "hamsters", "hamilton", "hamlin", "chickenpox", "duckling", "goatee", "hamburgerhelper"]);
function meatHits(text: string): boolean {
  if (!text) return false;
  for (const tok of scanTokens(text)) {
    if (MEAT_STEM_LOOKALIKE.has(tok)) continue;
    for (const stem of PREFIX_MEAT) {
      if (tok === stem) continue;
      if (tok.startsWith(stem) && tok.length > stem.length) {
        const rest = tok.slice(stem.length);
        if (MADE_OR_FOOD_CONTINUATION.has(rest) || (rest.length >= 3 && /^[a-z]+$/.test(rest))) return true;
      }
    }
  }
  return false;
}

function frenchPrep(text: string, id: string): string {
  let s = foldScan(text);
  if (id === "dairy") s = s.replace(FR_DAIRY_PLANT_LOOKALIKE, " ");
  if (id === "nuts") s = s.replace(FR_NUT_COCONUT_LOOKALIKE, " ");
  return s;
}

export function frenchHits(id: string, text: string): boolean {
  const re = FR_SHIELD[id];
  if (!re || !text) return false;
  return re.test(frenchPrep(text, id));
}

function splitListSegments(raw: string): string[] {
  // Sentences first, then dashed referrals like "… salt - see package for allergens".
  const sentences = raw.split(/(?<=[.;\n])\s+|\s+[–—-]\s+/);
  const kept: string[] = [];
  for (const sent of sentences) {
    const t = sent.trim();
    if (!t) continue;
    if (WHOLE_SEGMENT_PLACEHOLDER.test(t.replace(/^[.,;:]+|[.,;:]+$/g, "").trim())) continue;
    if (ALLERGEN_STATEMENT.test(t)) continue;
    if (PACKAGE_REFERRAL.test(t)) continue;
    kept.push(t);
  }
  return kept;
}

const NUTRITION_LINE = /\b\d+\s*(?:mg|mcg|ug|g|kg|ml|l|kcal|cal|iu|%|uantité|quantite)\b|sodium\s*\(\s*na\s*\)/i;

function hasFoodWord(item: string): boolean {
  return scanTokens(item).some((w) => FOOD_WORDS.has(w));
}

// Vague filler items: they never count toward a MADE product's 2-item minimum.
// Whole item only (so "tomato sauce" and "garlic salt" stay specific). English and French.
const FILLER_ITEM =
  /^(?:spices?|seasonings?|sauces?|herbs?|flavou?rs?|natural flavou?rs?|artificial flavou?rs?|flavou?rings?|spice extracts?|seasoning blends?|other ingredients|epices|assaisonnements?|aromes?|arome naturels?|fines herbes)$/i;

export function isFillerItem(item: string): boolean {
  const t = foldScan(item).replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > 0 && FILLER_ITEM.test(t);
}

export function isRealIngredientList(raw: string | undefined | null, title?: string): boolean {
  let s = (raw ?? "").trim();
  if (!s) return false;
  s = s.replace(/^(?:ingredients|ingr[eé]dients)\s*:\s*/i, "").trim();
  if (!s) return false;
  const remainder = splitListSegments(s).join(" ").trim();
  if (!remainder) return false;
  const rawItems = remainder.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  // Whole-item placeholders ("Na", "N/A", "none") do not count toward a real list; they never
  // void neighbouring food items by substring ("Sodium (Na) 200 mg" stays inside its item).
  const items = rawItems.filter((item) => !WHOLE_SEGMENT_PLACEHOLDER.test(item.replace(/^[.,;:]+|[.,;:]+$/g, "").trim()));
  const droppedPlaceholderItem = items.length !== rawItems.length;
  const made = Boolean(title && isMadeProductTitle(title));
  if (made) {
    // A made product needs at least two SPECIFIC (non-filler) items. "Basil.", "Sauce.",
    // "Spices.", "Spices, sauce.", "Basil, seasoning.", "Herbs, natural flavour." and
    // "Spices, salt." (salt is the only specific item) are all no list.
    const specific = items.filter((item) => !isFillerItem(item));
    return specific.length >= 2 && specific.some(hasFoodWord);
  }
  const food = items.some(hasFoodWord);
  if (items.length >= 2) return food;
  // Plain non-made foods keep the one-honest-item rule ("Tomatoes.", "Olive oil.",
  // "Catfish.", "Chicken.") when nothing was stripped and the line is not a nutrition fact.
  if (items.length === 1 && food && !NUTRITION_LINE.test(items[0]!)) {
    const afterLabel = s;
    const strippedSomething = droppedPlaceholderItem || splitListSegments(afterLabel).join(" ").trim() !== afterLabel.trim();
    if (!strippedSomething) return true;
  }
  return false;
}

/** Single-ingredient raw foods whose title alone is enough to judge a shield. */
function wholeFood(a: Attrs, title: string): boolean {
  // A made-product word is never a whole food, even on meat / seafood / produce.
  if (isMadeProductTitle(title)) return false;
  if (a.prepared.length) return false;
  if (a.category === "meat" || a.category === "seafood") return !a.ground || a.species.length === 1;
  if (a.category === "produce") return a.form !== "canned" && a.form !== "dried";
  if (a.category === "eggs") return true;
  return false;
}

export function shieldBlocks(
  product: MatchProduct,
  profile: ShieldProfile | undefined,
  opts: { ignoreDoubt?: boolean } = {},
): string[] {
  const allergies = new Set((profile?.allergies ?? []).map((a) => a.toLowerCase()));
  const prefs = new Set((profile?.prefs ?? []).map((p) => p.toLowerCase()));
  if (prefs.has("gluten-free")) allergies.add("gluten");
  if (prefs.has("dairy-free")) allergies.add("dairy");
  if (prefs.has("vegan")) {
    allergies.add("dairy");
    allergies.add("egg");
  }
  if (allergies.size === 0 && !prefs.has("vegetarian") && !prefs.has("vegan") && !prefs.has("pescatarian") && !prefs.has("sugar-free")) {
    return [];
  }
  const title = product.name;
  const attrs = parseAttrs(title);
  // Always keep the raw text so a non-real list can still ADD refusals (shrimp in "see package. Shrimp").
  const ingredients = product.ingredients?.trim() ?? "";
  const realList = isRealIngredientList(ingredients, title);
  // Drop "free" claims ("nut-free", "made in a facility free from peanuts") before testing; warnings stay.
  const clean = (x: string) =>
    sentences(x.replace(FREE_CLAIM, " "))
      .map((sentence) => (/may (?:also )?contain|\btraces?\b/i.test(sentence) ? sentence : sentence.replace(/\bfree (?:of|from)\b[^.;\n]*/gi, " ")))
      .join(". ");
  const plain = (x: string) => clean(x).replace(PLANT_LOOKALIKE, " ");
  const stateFree = (id: string) => {
    const t = norm(title);
    if (id === "gluten") return has(t, W("gluten free|gf|sans gluten"));
    if (id === "dairy") return has(t, W("dairy free|non dairy|lactose free"));
    return false;
  };
  const out: string[] = [];
  // A made product with no real list is never a whole food; doubt fails every asked tag.
  const doubt = !opts.ignoreDoubt && !wholeFood(attrs, title) && !realList;
  // Split / joined-stem / French checks always run on the title and the list (add-only).
  const splitTitle = safetySplitTitle(title);
  for (const id of allergies) {
    const re = SHIELD_RE[id];
    if (!re) {
      out.push(`${id}: unknown shield, blocked`);
      continue;
    }
    // Dairy lookalikes (coconut milk, peanut butter...) are plant foods; nuts still see "peanut".
    const prep = id === "dairy" ? plain : clean;
    // A precautionary line ("may contain traces of tree nuts", "made in a facility with milk") always fails.
    if (precautionHit(id, ingredients)) {
      out.push(`${id} shield: may contain (ingredients list)`);
      continue;
    }
    // Raw-title word-boundary matching always (814f702). Joined-stem and split-title checks
    // always run on the title and the list, and can only add refusals, whether or not the list is real.
    const titleHit =
      re.test(prep(title)) ||
      re.test(prep(splitTitle)) ||
      stemHits(id, title) ||
      stemHits(id, splitTitle) ||
      frenchHits(id, title);
    if (titleHit && !stateFree(id)) {
      out.push(`${id} shield: "${title}"`);
      continue;
    }
    // List text (real or not) can only add refusals: word-boundary, stems, and French lexicon.
    const splitIngredients = splitGlutenFoodWords(ingredients);
    if (
      ingredients &&
      (re.test(prep(ingredients)) ||
        re.test(prep(splitIngredients)) ||
        stemHits(id, ingredients) ||
        stemHits(id, splitIngredients) ||
        frenchHits(id, ingredients))
    ) {
      out.push(`${id} shield: ingredients list`);
      continue;
    }
    if (doubt && !stateFree(id)) out.push(`${id} shield: no ingredient list to check`);
  }
  const veg = (x: string) => plain(x).replace(MEAT_LOOKALIKE, " ");
  // Raw + split title + list (add-only). Stems and French meat/fish words can only add a refusal.
  const vegText = `${veg(title)} ${veg(splitTitle)} ${veg(ingredients)}`;
  // Pescatarian must not treat the split of "Crabmeat" → "crab meat" as land meat.
  // Seafood "meat" compounds are also stripped by MEAT_LOOKALIKE.
  const pescText = `${veg(title)} ${veg(ingredients)}`;
  const seaStem =
    stemHits("fish", title) || stemHits("fish", splitTitle) || stemHits("fish", ingredients) ||
    stemHits("shellfish", title) || stemHits("shellfish", splitTitle) || stemHits("shellfish", ingredients) ||
    frenchHits("fish", title) || frenchHits("fish", ingredients) ||
    frenchHits("shellfish", title) || frenchHits("shellfish", ingredients);
  const meatStem = FR_MEAT.test(foldScan(`${title} ${ingredients}`)) || meatHits(title) || meatHits(ingredients);
  if (prefs.has("vegetarian") || prefs.has("vegan")) {
    const who = prefs.has("vegan") ? "vegan" : "vegetarian";
    const plantTitle = attrs.prepared.includes("plant");
    if ((!plantTitle && (attrs.category === "meat" || attrs.category === "seafood")) || MEAT_RE.test(vegText) || SEAFOOD_RE.test(vegText) || seaStem || meatStem) {
      out.push(`${who}: contains meat or fish`);
    } else if (doubt) out.push(`${who}: no ingredient list to check`);
  } else if (prefs.has("pescatarian")) {
    const plantTitle = attrs.prepared.includes("plant");
    if ((!plantTitle && attrs.category === "meat") || MEAT_RE.test(pescText) || meatStem) out.push("pescatarian: contains meat");
    else if (doubt) out.push("pescatarian: no ingredient list to check");
  }
  if (prefs.has("vegan") && VEGAN_ANIMAL.test(`${title} ${ingredients}`)) out.push("vegan: animal product");
  if (prefs.has("sugar-free")) {
    const text = `${title} ${ingredients}`;
    if (SUGAR_RE.test(text) && !has(norm(title), W("sugar free|no sugar added|unsweetened"))) out.push("sugar-free: contains sugar");
    else if (doubt && !has(norm(title), W("sugar free|no sugar added|unsweetened"))) out.push("sugar-free: no ingredient list to check");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Compare

/** Generic meat/fish with no cut and not ground: the cook has to choose. */
export function needsCutChoice(need: Attrs): boolean {
  return (
    (need.category === "meat" || need.category === "seafood") &&
    need.prepared.length === 0 &&
    need.cuts.length === 0 &&
    !need.ground &&
    !isWholeAnimal(need)
  );
}

function isWholeAnimal(a: Attrs): boolean {
  // Shellfish lines name the animal itself (shrimp, mussels, live lobster).
  return a.species.some((s) => ["shrimp", "scallop", "lobster", "crab", "mussel", "clam", "oyster", "sardine", "anchovy"].includes(s));
}

function cutsEqual(need: string[], product: string[]): boolean {
  const a = new Set(need);
  const b = new Set(product);
  // Pork chops are sold as loin chops; that is the same cut.
  if (a.has("chop") && !a.has("loin")) b.delete("loin");
  if (b.has("chop") && !b.has("loin")) a.delete("loin");
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

const BREADCRUMB_BAD: Record<string, RegExp> = {
  any: /\b(pet|pets|baby care|health|beauty|household|cleaning|home|kitchen ?ware|toys?)\b/i,
  meat: /prepared meals|frozen meals|deli meats|snacks?|soups?|sauces?|pantry|canned|bakery/i,
  seafood: /prepared meals|frozen meals|snacks?|soups?|sauces?|bakery/i,
};

/**
 * k1 (Kitchen ruling, Nov 15): a line that itself says the item comes canned or tinned (a can/tin unit, or
 * can/canned/tin/tinned in its name) accepts shelf titles saying "Canned"/"Tinned". "1 can chickpeas" ->
 * "PC No Name Canned Chickpeas" is the same food. Lines without that wording keep rejecting canned.
 */
const CAN_UNIT = /^(?:cans?|tins?|canned|tinned)\.?$/i;
const CAN_WORDS = /\b(?:cans?|canned|tins?|tinned)\b/i;
const CANNED_TITLE = /\b(?:canned|tinned)\b/i;
export function lineSaysCanned(line: { name: string; unit?: string }): boolean {
  return CAN_UNIT.test((line.unit ?? "").trim()) || CAN_WORDS.test(line.name);
}

export type CompareOpts = { canOk?: boolean; unit?: string };

/** k2 (e): packaged-product forms. "purée"/"pureed" are puree. */
const PRODUCT_FORMS: [string, RegExp][] = [
  ["diced", /\bdiced\b/],
  ["whole", /\bwhole\b/],
  ["crushed", /\bcrushed\b/],
  ["stewed", /\bstewed\b/],
  ["puree", /\b(?:puree|pureed)\b/],
  ["paste", /\bpaste\b/],
  ["sauce", /\bsauce\b/],
];
const FORM_EXEMPT = new Set(["meat", "seafood"]);
/** Forms that *are* the product (not a cut). "applesauce" is "apple sauce". */
const PRODUCT_IS_FORM = new Set(["paste", "sauce", "puree"]);
const JAR_UNIT = /^(?:jars?)$/i;
/** Space-insensitive hay for form words: "applesauce" reads as "apple sauce". Only paste/sauce/puree, so "wholesome" is not "whole". */
function formHay(text: string): string {
  return norm(text).replace(/\b([a-z]{3,})(sauce|paste|pureed|puree)\b/g, "$1 $2");
}
export function productForms(text: string): Set<string> {
  const t = formHay(text);
  return new Set(PRODUCT_FORMS.filter(([, re]) => re.test(t)).map(([id]) => id));
}

/**
 * k2 r2: the named-form rule applies only on a canned/jarred line (unit can/cans/tin/tins/jar/jars,
 * or the line says canned/tinned) or when the form itself is the product (paste, sauce, puree).
 * Fresh lines ("crushed garlic", "diced onion", "diced tomatoes") skip it. Meat and seafood stay exempt.
 */
export function formRuleApplies(line: { name: string; unit?: string }, category?: string): boolean {
  if (FORM_EXEMPT.has(category ?? "")) return false;
  if (JAR_UNIT.test((line.unit ?? "").trim()) || lineSaysCanned(line)) return true;
  const forms = productForms(line.name);
  return [...forms].some((f) => PRODUCT_IS_FORM.has(f));
}

export function compare(needText: string, product: MatchProduct, aisle?: string, opts: CompareOpts = {}): Verdict {
  const need = parseAttrs(needText);
  const prod = parseAttrs(product.name);
  const blocked: string[] = [];
  const differs: string[] = [];
  const missing: string[] = [];

  if (prod.category === "nonfood") blocked.push("not food");
  if (product.breadcrumbs?.length) {
    const crumbs = product.breadcrumbs.join(" / ");
    if (product.breadcrumbs[0] && !/food/i.test(product.breadcrumbs[0])) blocked.push(`wrong aisle: ${crumbs}`);
    else if (BREADCRUMB_BAD.any!.test(crumbs)) blocked.push(`wrong aisle: ${crumbs}`);
    else if ((need.category === "meat" || need.category === "seafood") && BREADCRUMB_BAD[need.category]!.test(crumbs)) {
      differs.push(`aisle: ${product.breadcrumbs.at(-1)}`);
    }
    // The store's own aisle says frozen: frozen never counts as fresh.
    if ((need.form ?? "fresh") === "fresh") {
      const last = product.breadcrumbs.at(-1) ?? "";
      if (/\bfrozen\b/i.test(last) && !/\b(meat|deli|fresh)\b/i.test(last)) differs.push(`frozen aisle: ${last}`);
      else if (/\bfrozen\b/i.test(crumbs)) missing.push(`store files it under ${last || "frozen"}; can't confirm fresh`);
    }
  }
  if (aisle === "Meat & Seafood" && prod.category !== "meat" && prod.category !== "seafood" && prod.category !== "unknown") {
    differs.push("not a meat or seafood pack");
  }

  // Species
  const ns = new Set(need.species);
  const ps = new Set(prod.species);
  if (ns.size || ps.size) {
    const same = ns.size === ps.size && [...ns].every((s) => ps.has(s));
    if (!same) {
      if (ns.size && ps.size) differs.push(`different ${need.category === "seafood" ? "fish" : "meat"}: ${[...ps].join(" & ")}, not ${[...ns].join(" & ")}`);
      else if (ns.size) differs.push(`no ${[...ns].join(" & ")} in the name`);
      else differs.push(`contains ${[...ps].join(" & ")}`);
    }
  }

  // Cut / ground
  if (ns.size) {
    if (need.ground !== prod.ground) differs.push(need.ground ? "not ground" : "ground, recipe wants a cut");
    if (need.cuts.length) {
      if (!cutsEqual(need.cuts, prod.cuts)) {
        differs.push(prod.cuts.length ? `cut: ${prod.cuts.join(" ")}, recipe says ${need.cuts.join(" ")}` : `doesn't say ${need.cuts.join(" ")}`);
      }
    } else if (!need.ground && prod.cuts.length && needsCutChoice(need)) {
      // generic line: every cut is a choice, none is a pick (handled by caller)
    } else if (prod.cuts.length && !needsCutChoice(need)) {
      differs.push(`cut: ${prod.cuts.join(" ")}, recipe names no cut`);
    }
  }

  // Bone / skin
  if (need.bone) {
    if (!prod.bone) missing.push(`doesn't say ${need.bone}`);
    else if (prod.bone !== need.bone) differs.push(prod.bone);
  }
  if (need.skin) {
    if (!prod.skin) missing.push(`doesn't say ${need.skin}`);
    else if (prod.skin !== need.skin) differs.push(prod.skin);
  }

  // Fresh / frozen / canned / dried. Frozen never counts as fresh.
  const needForm = need.form ?? "fresh";
  let prodForm = prod.form;
  if (!prodForm && needForm === "canned" && product.ml && prod.category !== "dairy") prodForm = "canned";
  if (!prodForm && needForm === "dried" && prod.category === "pantry") prodForm = "dried";
  if (needForm === "fresh") {
    if (prodForm === "frozen") differs.push("frozen, recipe means fresh");
    else if (prodForm === "canned") {
      // k1: only a line with can/tin wording (and no explicit "fresh") takes a title that says Canned/Tinned.
      if (!(opts.canOk && need.form === undefined && CANNED_TITLE.test(product.name))) differs.push("canned, recipe means fresh");
    }
    else if (prodForm === "dried" && (prod.category === "produce" || need.category === "produce")) differs.push("dried, recipe means fresh");
  } else if (prodForm !== needForm) {
    if (!prodForm || prodForm === "fresh") missing.push(`doesn't say ${needForm}`);
    else differs.push(`${prodForm}, recipe says ${needForm}`);
  }

  // Fat grade (ground meat). A named grade must match. An ungraded line takes any grade;
  // pickExact prefers regular/medium/unlabelled and only falls back to lean when that's all there is.
  if ((need.ground || prod.ground) && need.fat && prod.fat !== need.fat) {
    differs.push(prod.fat ? `${prod.fat}, recipe says ${need.fat}` : `doesn't say ${need.fat}`);
  }

  // Organic: required only when the line asks for it; excluded when the line says it doesn't want it.
  // Otherwise organic and regular compete on total cost like any other exact match.
  if (need.organic && !prod.organic) missing.push("doesn't say organic");
  if (need.avoidOrganic && prod.organic) blocked.push("organic, recipe says not organic");

  // Prepared / marinated / processed: only when the recipe asked for it.
  const np = new Set(need.prepared);
  const extraPrep = prod.prepared.filter((p) => !np.has(p));
  if (extraPrep.length) differs.push(`${extraPrep.join(", ")}`);
  const lostPrep = need.prepared.filter((p) => !prod.prepared.includes(p) && p !== "soup" && p !== "sauce");
  if (lostPrep.length) missing.push(`doesn't say ${lostPrep.join(", ")}`);

  if (need.salted === "unsalted" && prod.salted !== "unsalted") differs.push(prod.salted ? "salted, recipe says unsalted" : "doesn't say unsalted");
  if (need.salted === "salted" && prod.salted === "unsalted") differs.push("unsalted, recipe says salted");

  for (const d of need.diet) if (!prod.diet.includes(d)) missing.push(`doesn't say ${d}`);

  // Packaged foods: "diced", "crushed", "shredded"... name a different product, so the pack must say it.
  // Produce and meat lines use these as prep steps and skip this.
  const packaged = need.form === "canned" || need.form === "dried" || need.form === "frozen";
  if (packaged || (need.category !== "produce" && need.category !== "meat" && need.category !== "seafood")) {
    const tn = norm(needText);
    const tp = norm(product.name);
    for (const w of ["diced", "crushed", "shredded", "grated", "sliced", "chopped", "minced", "whole", "strained", "puree", "pureed", "stewed"]) {
      if (has(tn, W(w)) && !has(tp, W(w))) missing.push(`doesn't say ${w}`);
    }
  }

  // k2 (e) / r2: a named form on a canned/jarred line, or when the form is the product (paste, sauce, puree):
  // a title naming a different form is a different product. Fresh produce skips this. Meat and seafood keep their cut rules.
  if (formRuleApplies({ name: needText, unit: opts.unit }, need.category)) {
    const nf = productForms(needText);
    const pf = productForms(product.name);
    if (nf.size && pf.size && ![...pf].some((f) => nf.has(f))) differs.push(`${[...pf].join(", ")}, recipe says ${[...nf].join(", ")}`);
  }

  if (need.sizeGrade && prod.sizeGrade && need.sizeGrade !== prod.sizeGrade) differs.push(`${prod.sizeGrade}, recipe says ${need.sizeGrade}`);

  // Same food at all? Token/head/other-food check on the attribute-free text.
  const sameAnimal = ns.size > 0 && ns.size === ps.size && [...ns].every((x) => ps.has(x)) && need.prepared.length === 0;
  // A bare family line ("cheese"): any recognised kind of that family is the same product type (the picker asks which).
  const vague = vagueFood(need);
  const otherKind = Boolean(vague && VAGUE_FOODS.find((v) => v.kind === vague)?.other.test(norm(product.name)));
  if (otherKind) differs.push("different product");
  const familyMember = !otherKind && Boolean(vague && (kindOf(vague, product.name) || new RegExp(`\\b${vague}\\b`).test(norm(product.name))) && prod.prepared.length === 0);
  if (!sameAnimal && !familyMember && !differs.some((d) => d.startsWith("different ")) && need.core && !isRelevantProduct(prod.core || product.name, need.core, { plantOk: need.prepared.includes("plant") && prod.prepared.includes("plant") })) {
    const alias = sameTypeAlias(need.core, prod.core || norm(product.name));
    if (alias) differs.push(alias);
    else {
      const overlap = need.core.split(" ").filter((w) => w.length > 2 && prod.core.includes(w));
      differs.push(overlap.length ? "different product" : `not named "${need.core}", check it's what you want`);
    }
  }

  return { ok: blocked.length === 0 && differs.length === 0 && missing.length === 0, blocked, differs, missing };
}

// ---------------------------------------------------------------------------
// Amounts, unit price, cover

const OZ_G = 28.35;
const LB_G = 453.6;
const PACKAGE_UNITS = new Set(["can", "cans", "jar", "jars", "bottle", "bottles", "box", "boxes", "bag", "bags", "pack", "packs", "pkg", "package", "packages", "carton", "cartons", "tin", "tins"]);
const EACH_UNITS = new Set(["", "ea", "each", "ct", "count", "whole", "item", "items", "clove", "cloves", "head", "heads", "bunch", "bunches", "large", "medium", "small"]);
const VOLUME_ML: Record<string, number> = { ml: 1, milliliter: 1, millilitre: 1, l: 1000, liter: 1000, litre: 1000, liters: 1000, litres: 1000, cup: 240, cups: 240, tbsp: 15, tablespoon: 15, tablespoons: 15, tsp: 5, teaspoon: 5, teaspoons: 5, "fl oz": 29.5735, "fl. oz": 29.5735, floz: 29.5735, "fluid ounce": 29.5735, "fluid ounces": 29.5735, "us fl oz": 29.5735, "fl ounce": 29.5735, "fl ounces": 29.5735 }; // US fluid ounce: a loose fl oz amount never buys too little
const MASS_G: Record<string, number> = { g: 1, gram: 1, grams: 1, kg: 1000, kilogram: 1000, kilograms: 1000, oz: OZ_G, ounce: OZ_G, ounces: OZ_G, lb: LB_G, lbs: LB_G, pound: LB_G, pounds: LB_G };

/** Typical weight of one, for produce bought by the bag or by the kg. */
export const EACH_GRAMS: { re: RegExp; g: number }[] = [
  { re: /onion/, g: 150 },
  { re: /sweet potato/, g: 250 },
  { re: /potato/, g: 200 },
  { re: /carrot/, g: 70 },
  { re: /garlic.*clove|clove.*garlic/, g: 5 },
  { re: /garlic/, g: 50 },
  { re: /lemon/, g: 110 },
  { re: /lime/, g: 70 },
  { re: /tomato/, g: 120 },
  { re: /apple/, g: 180 },
  { re: /banana/, g: 120 },
  { re: /bell pepper|green pepper|red pepper/, g: 160 },
  { re: /zucchini/, g: 200 },
  { re: /cucumber/, g: 300 },
  { re: /avocado/, g: 170 },
  { re: /chicken breast/, g: 230 },
  { re: /chicken thigh/, g: 110 },
];

/** US fluid ounce in ml. A loose fl oz amount converts at this (larger) rate so it never buys too little. */
export const US_FL_OZ_ML = 29.5735;
/** Kitchen ruling: "N cans (X fl oz)" takes N shelf cans between X × 28.41 ml (Imperial) and X × 29.57 ml (US). */
export const CAN_FL_OZ_MIN_ML = 28.41;
export const CAN_FL_OZ_MAX_ML = 29.57;

/** Is this metric can size what a label means by "X fl oz"? Shelf labels are whole ml, so the range ends round outward. */
export function canMatchesFlOz(ml: number, oz: number): boolean {
  return ml >= Math.floor(oz * CAN_FL_OZ_MIN_ML) && ml <= Math.ceil(oz * CAN_FL_OZ_MAX_ML);
}

/**
 * k2 r3 (f): a bare "N oz can" is a Canadian label size.
 * If the shelf has the standard table size (exact ml, ±1 ml), take that (cheapest among table-size matches).
 * Only if no table-size can is on the shelf, accept 0 to +10% over N × 28.4 ml (cheapest among those).
 * Never short. 14 oz takes 398 if present, else 400; 19 oz takes 540 if present, else 568.
 * 15 oz does not take 398 ml; 28 oz takes 796, not 750.
 */
export const CAN_OZ_ML = 28.4;
export const CAN_OZ_TOLERANCE = 0.1;
export const CAN_OZ_STANDARD_ML: Record<string, number> = {
  "5.5": 156,
  "10": 284,
  "14": 398,
  "19": 540,
  "28": 796,
};
export function canStandardMl(oz: number): number | undefined {
  return CAN_OZ_STANDARD_ML[String(oz)] ?? CAN_OZ_STANDARD_ML[String(Number(oz))];
}
export function canMatchesOzTable(ml: number, oz: number): boolean {
  const standard = canStandardMl(oz);
  return standard != null && Math.abs(ml - standard) <= 1;
}
export function canMatchesOzOver(ml: number, oz: number): boolean {
  const want = oz * CAN_OZ_ML;
  return ml + 1e-9 >= want && ml <= want * (1 + CAN_OZ_TOLERANCE) + 1e-9;
}
/** Covers the line: table size, or (when used as a fallback) 0 to +10% over. Ranking prefers the table when any exists. */
export function canMatchesOz(ml: number, oz: number): boolean {
  return canMatchesOzTable(ml, oz) || canMatchesOzOver(ml, oz);
}
const BARE_OZ_RE = /(\d+(?:[.,]\d+)?)\s*-?\s*(?:oz|ounces?)\.?(?![a-z])/i;
/** Can wording as a container (not "Canada", "candied", "pecan", "scant", "cane"). */
const CAN_CONTAINER = /\b(?:cans?|tins?|canned|tinned)\b/i;

/** "28 fl oz", "28 fl. oz.", "28 US fl oz", "28 fluid ounces", "28 imperial fl oz". */
const FL_OZ_RE = /(\d+(?:[.,]\d+)?)\s*(?:u\.?s\.?\s*|imperial\s*|imp\.?\s*)?(?:fl\.?\s*oz\.?|fluid\s*ounces?|fl\.?\s*ounces?)(?![a-z])/i;

/** First package size printed in a line: "(796 ml)", "28 fl oz", "1.36 kg", "19 oz". */
export function printedSize(text: string): { ml?: number; g?: number } | null {
  const fl = FL_OZ_RE.exec(text);
  if (fl) {
    const n = Number(fl[1]!.replace(",", "."));
    if (n > 0) return { ml: n * US_FL_OZ_ML };
  }
  const m = /(\d+(?:[.,]\d+)?)\s*(fl\.? ?oz|ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|kg|g|grams?|oz|lbs?)\b/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(",", "."));
  const unit = m[2]!.toLowerCase().replace(/\.|\s/g, "");
  if (!(n > 0)) return null;
  if (unit === "floz") return { ml: n * US_FL_OZ_ML };
  if (unit === "ml" || unit.startsWith("millilit")) return { ml: n };
  if (unit === "l" || unit.startsWith("lit")) return { ml: n * 1000 };
  if (unit === "kg") return { g: n * 1000 };
  if (unit === "g" || unit.startsWith("gram")) return { g: n };
  if (unit === "oz") return { g: n * OZ_G };
  if (unit.startsWith("lb")) return { g: n * LB_G };
  return null;
}

export function needAmount(
  line: NeedLine,
  gramsPerCup?: number,
): { g?: number; ml?: number; each?: number; packages?: number; printed?: boolean; canFlOz?: number; canOz?: number; cans?: number } {
  const u = (line.unit || "").trim().toLowerCase().replace(/\.$/, "");
  const q = Math.abs(Number(line.qty)) || 0;
  if (!q) return {};
  if (MASS_G[u]) return { g: q * MASS_G[u]! };
  if (VOLUME_ML[u]) {
    const ml = q * VOLUME_ML[u]!;
    return gramsPerCup ? { ml, g: (ml / 240) * gramsPerCup } : { ml };
  }
  // A printed package size ("2 cans (796 ml)", "1 jar 500 g") is the amount to cover:
  // 2 × 796 ml = 1,592 ml, whatever can size the store sells.
  const containerWord = /\b(?:cans?|jars?|tins?|bottles?|cartons?|boxes|box|bags?|packs?|packages?|pkgs?)\b/i.test(`${u} ${line.name}`);
  if (PACKAGE_UNITS.has(u) || (EACH_UNITS.has(u) && containerWord)) {
    const text = `${line.unit ?? ""} ${line.name}`;
    const printed = printedSize(text);
    // Only "fl oz" is volume. A bare "oz" is weight: printedSize reads it as grams, and a product that
    // lists only a volume can't be shown to cover it, so the picker asks instead of converting.
    // "N cans (X fl oz)": a shelf can whose metric size is X fl oz in Imperial or US measure is that can
    // (coverNeed takes N of it); anything else must cover the US volume, the larger of the two.
    // A metric size printed on the line ("28 fl oz (796 ml)") is the amount; it beats any ounce figure.
    const metric = /(\d+(?:[.,]\d+)?)\s*(ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|kg|g|grams?)\b/i.exec(text);
    if (metric) {
      const m = printedSize(`${metric[1]} ${metric[2]}`);
      if (m?.ml) return { ml: Math.ceil(q) * m.ml, printed: true };
      if (m?.g) return { g: Math.ceil(q) * m.g, printed: true };
    }
    const flOz = FL_OZ_RE.exec(text);
    if (flOz) {
      const oz = Number(flOz[1]!.replace(",", "."));
      const isCan = /\b(?:cans?|tins?|canned|tinned)\b/i.test(text);
      if (oz > 0) return isCan ? { ml: Math.ceil(q) * oz * US_FL_OZ_ML, printed: true, canFlOz: oz, cans: Math.ceil(q) } : { ml: Math.ceil(q) * oz * US_FL_OZ_ML, printed: true };
    }
    // k2 r3 (f): "N oz can" / "(N oz) tin" is also a can size in fluid ounces (Canadian label). The weight
    // reading stays for products listed in grams; a can listed in ml matches the standard table, or 0 to +10% over when no table size is on the shelf.
    const bareOz = BARE_OZ_RE.exec(text);
    if (bareOz && CAN_CONTAINER.test(text)) {
      const oz = Number(bareOz[1]!.replace(",", "."));
      if (oz > 0) return { g: Math.ceil(q) * oz * OZ_G, printed: true, canOz: oz, cans: Math.ceil(q) };
    }
    if (printed?.ml) return { ml: Math.ceil(q) * printed.ml, printed: true };
    if (printed?.g) return { g: Math.ceil(q) * printed.g, printed: true };
  }
  if (PACKAGE_UNITS.has(u)) return { packages: Math.ceil(q) };
  // k2: no unit, but the line itself says can/tin ("tinned tomatoes", "1 can of coconut milk"): count cans.
  // A leading "N can(s)" in the name is that many per quantity.
  if (u === "" && CAN_CONTAINER.test(line.name)) {
    const lead = /^\s*(\d+)\s+(?:cans?|tins?)\b/i.exec(line.name);
    return { packages: Math.ceil(q) * (lead ? Number(lead[1]) : 1) };
  }
  if (EACH_UNITS.has(u)) {
    const name = `${line.name} ${u}`.toLowerCase();
    const each = EACH_GRAMS.find((row) => row.re.test(name));
    return { each: Math.ceil(q), g: each ? Math.ceil(q) * each.g : undefined };
  }
  return {};
}

export function unitPriceOf(p: MatchProduct): { cad: number; per: "kg" | "L" | "each" } | null {
  if (p.unitPrice && p.unitPrice.cad > 0) return p.unitPrice;
  if (p.perKgCad) return { cad: round2(p.perKgCad), per: "kg" };
  if (p.grams) return { cad: round2((p.priceCad / p.grams) * 1000), per: "kg" };
  if (p.ml) return { cad: round2((p.priceCad / p.ml) * 1000), per: "L" };
  if (p.each) return { cad: round2(p.priceCad / p.each), per: "each" };
  return null;
}

/** Grams one tray holds: stated weight, else price ÷ per-kg rate. */
function trayGrams(p: MatchProduct): number | undefined {
  if (p.grams) return p.grams;
  if (p.estGrams) return p.estGrams;
  if (p.perKgCad && !p.soldByWeight && p.priceCad > 0) return (p.priceCad / p.perKgCad) * 1000;
  return undefined;
}

/**
 * Multi-buy on one loose item ("5 for $3.99", from the Grok workspace's shelf pricing).
 * k2 (Kitchen ruling, Nov 15): the deal applies only when the line's needed count is >= N. Below N the
 * regular unit price is used for ranking and display, and we never buy extra to reach a deal.
 * At or above N, each full group of N is bought at the deal and any remainder at the regular price
 * (need 6 with "5 for $3.99" at $1.69 = 3.99 + 1.69 = $5.68 for 6 packs). The cover says which deal was
 * used (`deal: "5 for $3.99"`) so the price is shown as the deal, never as a bare single price.
 * Only lowers a confirmed cover's price; never makes an unconfirmed match coverable, never changes packs.
 */
export function multiBuyLabel(dealCount: number, dealCad: number): string {
  return `${dealCount} for $${dealCad.toFixed(2)}`;
}

function withMultiBuy(p: MatchProduct, need: ReturnType<typeof needAmount>, cover: Cover | null): Cover | null {
  if (!cover || cover.byWeight || p.grams || p.ml || !(need.each || need.packages)) return cover;
  const size = Math.max(1, p.each || 1);
  const dealCount = p.dealCount;
  const dealCad = p.dealCad;
  if (size !== 1 || !dealCount || !dealCad || dealCount < 2 || dealCad >= p.priceCad * dealCount - 0.009) return cover;
  const packs = cover.packs;
  if (packs < dealCount) return cover;
  const full = Math.floor(packs / dealCount);
  const rem = packs - full * dealCount;
  const total = full * dealCad + rem * p.priceCad;
  if (total >= cover.totalCad - 0.009) return cover;
  const label = multiBuyLabel(dealCount, dealCad);
  return { ...cover, totalCad: round2(total), deal: rem > 0 ? `${label} + ${rem} × $${p.priceCad.toFixed(2)}` : label };
}

export function coverNeed(p: MatchProduct, line: NeedLine, gramsPerCup?: number): Cover | null {
  return withMultiBuy(p, needAmount(line, gramsPerCup), coverNeedBase(p, line, gramsPerCup));
}

function coverNeedBase(p: MatchProduct, line: NeedLine, gramsPerCup?: number): Cover | null {
  const need = needAmount(line, gramsPerCup);
  const share = (left: number, amount: number) => (amount > 0 ? left / amount : 0);
  // Sold by weight at the counter: you buy exactly the weight needed.
  if (p.soldByWeight && p.perKgCad && need.g) {
    return { packs: 1, totalCad: round2((need.g / 1000) * p.perKgCad), leftover: 0, leftoverShare: 0, byWeight: true };
  }
  // No metric size on the product: can't show it covers a printed size, so ask.
  if (need.printed && need.ml && !p.ml) return null;
  // "N cans (X fl oz)" and this can's metric size is X fl oz (Imperial–US): N of them.
  if (need.canFlOz && need.cans && p.ml && canMatchesFlOz(p.ml, need.canFlOz)) {
    return { packs: need.cans, totalCad: round2(need.cans * p.priceCad), leftover: 0, leftoverShare: 0, byWeight: false };
  }
  // k2 r3 (f): "N oz can" and this can is the standard size, or (as a fallback cover) 0 to +10% over N × 28.4 ml: N of them.
  if (need.canOz && need.cans && p.ml && canMatchesOz(p.ml, need.canOz)) {
    return { packs: need.cans, totalCad: round2(need.cans * p.priceCad), leftover: 0, leftoverShare: 0, byWeight: false };
  }
  if (need.printed && need.g && !trayGrams(p)) return null;
  const tray = trayGrams(p);
  if (need.g && tray) {
    const packs = Math.max(1, Math.ceil(need.g / tray - 1e-9));
    const price = p.priceCad;
    return { packs, totalCad: round2(packs * price), leftover: packs * tray - need.g, leftoverShare: share(packs * tray - need.g, need.g), byWeight: Boolean(p.perKgCad) };
  }
  if (need.ml && p.ml) {
    const packs = Math.max(1, Math.ceil(need.ml / p.ml - 1e-9));
    return { packs, totalCad: round2(packs * p.priceCad), leftover: packs * p.ml - need.ml, leftoverShare: share(packs * p.ml - need.ml, need.ml), byWeight: false };
  }
  if (need.packages) {
    // "1 can", "2 jars": one store package per package named.
    if (p.each && p.each > 1) {
      const packs = Math.ceil(need.packages / p.each);
      return { packs, totalCad: round2(packs * p.priceCad), leftover: packs * p.each - need.packages, leftoverShare: 0, byWeight: false };
    }
    return { packs: need.packages, totalCad: round2(need.packages * p.priceCad), leftover: 0, leftoverShare: 0, byWeight: false };
  }
  // "1 eggplant" against a priced-by-weight single item (one tile = one eggplant, store-estimated weight).
  if (need.each && !need.g && !p.each && p.perKgCad && !p.soldByWeight && tray) {
    return { packs: need.each, totalCad: round2(need.each * p.priceCad), leftover: 0, leftoverShare: 0, byWeight: true };
  }
  if (need.each && p.each) {
    const packs = Math.max(1, Math.ceil(need.each / p.each));
    return { packs, totalCad: round2(packs * p.priceCad), leftover: packs * p.each - need.each, leftoverShare: share(packs * p.each - need.each, need.each), byWeight: false };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Choose

export function rankCovered(rows: { product: MatchProduct; cover: Cover }[]): Ranked[] {
  const out = rows.map((r) => ({ ...r, unit: unitPriceOf(r.product) }));
  out.sort((a, b) => {
    if (a.cover.totalCad !== b.cover.totalCad) return a.cover.totalCad - b.cover.totalCad;
    const ua = a.unit?.cad ?? Infinity;
    const ub = b.unit?.cad ?? Infinity;
    if (a.unit && b.unit && a.unit.per === b.unit.per && ua !== ub) return ua - ub;
    if (a.cover.leftoverShare !== b.cover.leftoverShare) return a.cover.leftoverShare - b.cover.leftoverShare;
    return a.cover.packs - b.cover.packs;
  });
  return out;
}

export function describeNeed(line: NeedLine): string {
  return [line.qty, line.unit, line.name].filter((x) => x !== "" && x != null).join(" ").trim();
}

export function unitLabel(unit: Ranked["unit"]): string {
  if (!unit) return "";
  return `$${unit.cad.toFixed(2)}/${unit.per}`;
}

function sizeText(r: Ranked): string {
  const p = r.product;
  if (r.cover.byWeight && p.soldByWeight) return `${p.sizeLabel} (weighed)`;
  const tray = trayGrams(p);
  if (p.perKgCad && tray && !p.grams) return `~${Math.round(tray)} g tray`;
  return p.sizeLabel;
}

export function pickReason(r: Ranked, line: NeedLine, rivals: number, next?: Ranked): string {
  const parts = [`${r.cover.packs}× ${sizeText(r)}`];
  const u = unitLabel(r.unit);
  // k2: a multi-buy is shown as the deal itself, not as a single-item price.
  if (r.cover.deal) parts.push(r.cover.deal);
  else if (u) parts.push(u);
  parts.push(`$${r.cover.totalCad.toFixed(2)} total`);
  let why = `Cheapest exact match: ${parts.join(" · ")} covers ${describeNeed(line)}`;
  why += rivals > 1 ? `; lowest total of ${rivals} exact matches` : "; only exact match found";
  if (next) why += ` (next: $${next.cover.totalCad.toFixed(2)})`;
  if (r.cover.byWeight && !r.product.soldByWeight) why += ". Tray weight is the store's estimate";
  return `${why}.`;
}

function choiceLabel(r: Ranked, differs: string[], index: number): string {
  const size = `${r.cover.packs}× ${sizeText(r)}`;
  const u = unitLabel(r.unit);
  const what = differs.length ? differs.join("; ") : "matches what the recipe says";
  return `Choice ${index + 1}: ${r.product.name} — ${what} · ${size}${u ? ` · ${u}` : ""} · $${r.cover.totalCad.toFixed(2)}`;
}

export function normalizeUpc(gtin?: string): string | undefined {
  const digits = (gtin || "").replace(/\D/g, "");
  if (digits.length < 8 || /^0+$/.test(digits)) return undefined;
  // GTIN-14 with leading zeros -> UPC-A (12) when it fits, else EAN-13.
  const trimmed = digits.replace(/^0+/, "");
  if (trimmed.length <= 12) return trimmed.padStart(12, "0");
  if (trimmed.length === 13) return trimmed;
  return digits;
}

export type PickInput = {
  line: NeedLine;
  products: MatchProduct[];
  profile?: ShieldProfile;
  gramsPerCup?: number;
};

/** Shown when every match was refused only because its ingredients couldn't be read (still fails closed). */
export const UNCHECKED_LABEL_REASON = "We couldn't check what's in this, so we left it off to keep your settings safe.";

export function pickExact(input: PickInput): PickResult {
  const { line, profile, gramsPerCup } = input;
  const need = parseAttrs(line.name);
  const covered: { product: MatchProduct; cover: Cover }[] = [];
  const near: { product: MatchProduct; cover: Cover | null; differs: string[]; lead?: string }[] = [];
  let shieldHits = 0;
  let realShieldHits = 0;
  let unsized = 0;
  const generic = needsCutChoice(need);
  // A bare family name ("cheese") covers foods a cook wouldn't swap: ask which one.
  const vagueKind = vagueFood(need);
  const canOk = lineSaysCanned(line);
  const avoidOrganic = need.avoidOrganic || (profile?.prefs ?? []).some((p) => p.toLowerCase() === "no-organic");
  for (const product of input.products) {
    if (product.inStock === false) continue;
    if (avoidOrganic && !need.organic && parseAttrs(product.name).organic) continue;
    const shields = shieldBlocks(product, profile);
    if (shields.length) {
      shieldHits++;
      // Only "no ingredient list to check" reasons: the label couldn't be read, not a real hit.
      if (shields.some((reason) => !reason.endsWith("no ingredient list to check"))) realShieldHits++;
      continue;
    }
    const v = compare(line.name, product, line.aisle, { canOk, unit: line.unit });
    if (v.blocked.length) continue;
    const cover = coverNeed(product, line, gramsPerCup);
    const notes = [...v.differs, ...v.missing];
    if (generic) {
      const prod = parseAttrs(product.name);
      const lead = prod.cuts.length ? `cut: ${prod.cuts.join(" ")}` : prod.ground ? "ground" : "cut not stated";
      const rest = notes.filter((n) => !n.startsWith("cut"));
      if (!prod.cuts.length && !prod.ground) rest.push("cut not stated");
      near.push({ product, cover, differs: rest, lead });
      continue;
    }
    if (!v.ok) {
      near.push({ product, cover, differs: notes });
      continue;
    }
    if (!cover) {
      unsized++;
      near.push({ product, cover: null, differs: ["size or weight not listed, can't confirm it covers the amount"] });
      continue;
    }
    covered.push({ product, cover });
  }
  let ranked = rankCovered(covered);

  // "N cans (X fl oz)": when the shelf has that can (X × 28.41 … X × 29.57 ml), take N of it; other can
  // sizes only compete when no shelf can is that size (then they must cover the US volume).
  const canNeed = needAmount(line, gramsPerCup);
  if (canNeed.canFlOz && ranked.some((r) => r.product.ml && canMatchesFlOz(r.product.ml, canNeed.canFlOz!))) {
    ranked = ranked.filter((r) => r.product.ml && canMatchesFlOz(r.product.ml, canNeed.canFlOz!));
  }
  // k2 r3: table size first (cheapest among ±1 ml matches); only if none exist, 0 to +10% over (cheapest among those).
  if (canNeed.canOz) {
    const table = ranked.filter((r) => r.product.ml && canMatchesOzTable(r.product.ml, canNeed.canOz!));
    if (table.length) ranked = table;
    else {
      const over = ranked.filter((r) => r.product.ml && canMatchesOzOver(r.product.ml, canNeed.canOz!));
      if (over.length) ranked = over;
    }
  }
  // k2 (e) / r2: on a canned/jarred line, or when the form is the product, a title with no form only
  // competes when no candidate names the matching form. (Different forms were already refused in compare.)
  const needForms = productForms(line.name);
  if (needForms.size && formRuleApplies(line, need.category)) {
    const matching = ranked.filter((r) => [...productForms(r.product.name)].some((f) => needForms.has(f)));
    if (matching.length) ranked = matching;
  }

  // Ground meat with no grade: regular / medium / unlabelled first. Lean only when that's all there is,
  // and then the cheapest grade, with the reason on the line.
  let gradeNote = "";
  if (need.ground && !need.fat && ranked.length) {
    const plainGrade = ranked.filter((r) => {
      const f = parseAttrs(r.product.name).fat;
      return !f || f === "medium" || f === "regular";
    });
    if (plainGrade.length) ranked = plainGrade;
    else {
      const f = parseAttrs(ranked[0]!.product.name).fat ?? "graded";
      gradeNote = ` No regular or medium ground ${need.species.join(" & ") || "meat"} on the shelf, so this is the cheapest grade (${f}); the recipe names no grade.`;
    }
  }

  // Bone/skin not stated by the recipe but both forms on the shelf: ask.
  let ambiguity = "";
  const pkgNeed = needAmount(line, gramsPerCup).packages;
  if (!generic && pkgNeed && ranked.length > 1) {
    // Sizes within 25% of each other are the same "can" or "jar" (650 vs 680 ml); 398 vs 796 ml is not.
    const amounts = ranked.map((r) => r.product.ml ?? r.product.grams ?? 0);
    const known = amounts.filter((n) => n > 0);
    const spread = known.length === amounts.length && known.length ? Math.max(...known) / Math.min(...known) : 1;
    const labels = new Set(ranked.map((r) => r.product.sizeLabel));
    if (spread > 1.25 || (known.length !== amounts.length && labels.size > 1)) {
      const unit = (line.unit ?? "").trim();
      const item = (line.name ?? "").trim() || "this item";
      // k2 r2: a no-unit can line must name the item and ask which size; never `"" with no size`.
      ambiguity = unit
        ? `The recipe says "${unit}" with no size, and this store sells more than one size`
        : `Which size of ${item}? The recipe doesn't give a size, and this store sells more than one`;
    }
  }
  if (!ambiguity && !generic && ranked.length > 1 && (need.category === "meat" || need.category === "seafood")) {
    const attrs = ranked.map((r) => parseAttrs(r.product.name));
    const both = (vals: (string | undefined)[], x: string, y: string) => vals.includes(x) && vals.includes(y);
    if (!need.bone && both(attrs.map((a) => a.bone), "boneless", "bone-in")) ambiguity = "The recipe doesn't say bone-in or boneless";
    else if (!need.skin && both(attrs.map((a) => a.skin), "skinless", "skin-on")) ambiguity = "The recipe doesn't say skin-on or skinless";
  }

  if (!ambiguity && vagueKind && ranked.length) {
    // Always ask, even with one kind on the shelf: the cook picks, Spoonful doesn't guess.
    ambiguity = `The recipe just says "${vagueKind}" without saying which kind`;
  }

  if (ranked.length && !generic && !ambiguity) {
    const top = ranked[0]!;
    return {
      status: "pick",
      pick: top,
      ranked,
      choices: [],
      reason: pickReason(top, line, ranked.length, ranked[1]).replace(/\.$/, `.${gradeNote}`),
      pinnedUpc: normalizeUpc(top.product.gtin),
    };
  }

  type Pooled = { r: Ranked; differs: string[]; lead?: string };
  const exactPool: Pooled[] = ranked.map((r) => ({
    r,
    differs: [],
    lead: ambiguity
      ? vagueKind
        ? kindOf(vagueKind, r.product.name) || `kind not stated`
        : pkgNeed
          ? `${r.product.sizeLabel} size`
          : labelBoneSkin(r.product.name)
      : undefined,
  }));
  const sameType = near.filter((n) => sameProductType(n.differs));
  const nearPool: Pooled[] = [
    ...sameType
      .filter((n) => n.cover)
      .map((n) => ({ r: { product: n.product, cover: n.cover!, unit: unitPriceOf(n.product) }, differs: n.differs, lead: n.lead })),
    ...sameType
      .filter((n) => !n.cover)
      .map((n) => ({
        r: { product: n.product, cover: { packs: 1, totalCad: round2(n.product.priceCad), leftover: 0, leftoverShare: 0, byWeight: false }, unit: unitPriceOf(n.product) },
        differs: [...n.differs, ...(n.differs.some((d) => d.startsWith("size")) ? [] : ["size not confirmed"])],
        lead: n.lead,
      })),
  ];
  // Ambiguous form/size: the choices are the exact matches themselves.
  const pool: Pooled[] = ambiguity && (exactPool.length >= 2 || vagueKind) ? exactPool : [...exactPool, ...nearPool];
  pool.sort((a, b) => severity(a.differs) - severity(b.differs) || a.r.cover.totalCad - b.r.cover.totalCad);
  let picked = pool;
  if (ambiguity) {
    // One of each form first (cheapest boneless, cheapest bone-in, ...), then the rest.
    const seen = new Set<string>();
    const firsts = pool.filter((c) => {
      const k = c.lead ?? "";
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    picked = [...firsts, ...pool.filter((c) => !firsts.includes(c))];
  }
  const choices = picked.slice(0, 3).map((c, i) => {
    const differs = c.lead ? [c.lead, ...c.differs] : c.differs;
    return { ...c.r, differs, label: choiceLabel(c.r, differs, i) };
  });
  let reason: string;
  if (generic) reason = `The recipe says "${line.name}" with no cut. Pick the cut you want; Spoonful won't guess.`;
  else if (ambiguity) reason = `${ambiguity}. Pick one; Spoonful won't guess.`;
  else if (unsized && !choices.length) reason = `Found the item but the store doesn't list a size, so Spoonful can't confirm it covers ${describeNeed(line)}.`;
  else if (!choices.length && shieldHits && !realShieldHits) reason = UNCHECKED_LABEL_REASON;
  else if (!choices.length && shieldHits) reason = `Every match failed your allergy or diet settings. Nothing was picked.`;
  else if (!choices.length) reason = `Nothing on the shelf fits ${describeNeed(line)} at this store. Nothing was picked.`;
  else reason = `No exact match for ${describeNeed(line)}. Here ${choices.length === 1 ? "is the only close one" : `are the closest ${choices.length}`} of the same kind; nothing was picked.`;
  return { status: "ask", pick: null, ranked: [], choices, reason };
}

/**
 * Other names for the same product type. A product sold under one of these is the
 * same kind of food, so it may be shown as a labelled choice; it is never picked silently.
 */
const SAME_TYPE: { need: RegExp; prod: RegExp; label: (word: string) => string }[] = [
  { need: /\bsoy sauce\b/, prod: /\b(tamari|shoyu)\b/, label: (w) => `sold as ${w}, a soy sauce` },
  { need: /\b(?:scallions?|green onions?)\b/, prod: /\b(scallions?|green onions?|spring onions?)\b/, label: (w) => `sold as ${w}` },
  { need: /\bcilantro\b/, prod: /\b(coriander)\b/, label: (w) => `sold as ${w} (cilantro)` },
  { need: /\bchickpeas?\b/, prod: /\b(garbanzo beans?)\b/, label: (w) => `sold as ${w} (chickpeas)` },
  { need: /\bicing sugar\b|\bpowdered sugar\b|\bconfectioners sugar\b/, prod: /\b(icing sugar|powdered sugar|confectioners sugar)\b/, label: (w) => `sold as ${w}` },
];

function sameTypeAlias(needCore: string, prodCore: string): string | null {
  for (const row of SAME_TYPE) {
    if (!row.need.test(needCore)) continue;
    const m = row.prod.exec(prodCore);
    if (m) return row.label(m[1]!);
  }
  return null;
}

/** A near match that is a different kind of food (soy milk for soy sauce, beef for veal) is never offered. */
const OTHER_TYPE = /^(different product|not named |different meat|different fish|no .* in the name$|contains |not a meat or seafood pack|not food|wrong aisle)/;

function sameProductType(differs: string[]): boolean {
  return !differs.some((d) => OTHER_TYPE.test(d));
}

/** Family names that need the cook to choose a kind. Kitchen ruling: bare "cheese" asks. */
const VAGUE_FOODS: { kind: string; core: RegExp; kinds: RegExp; other: RegExp }[] = [
  {
    kind: "cheese",
    core: /^(?:cheese|cheeses)$/,
    kinds: /\b(old cheddar|medium cheddar|mild cheddar|white cheddar|cheddar|mozzarella|parmesan|parmigiano|romano|swiss|emmental|gouda|havarti|monterey jack|marble|colby|feta|brie|camembert|provolone|asiago|goat|blue|gruyere|halloumi|paneer|pizza mozzarella|tex mex|mexican|italian blend)\b/,
    // Spreads, fresh curd cheeses and cheese products are other product types for a recipe's "cheese".
    other: /\b(cream cheese|cottage|ricotta|quark|cheese (?:spread|sauce|dip|whiz|product|slices? product)|processed cheese|string cheese|cheese strings?|cheesecake|cheez|mac(?:aroni)? (?:and |n )?cheese)\b/,
  },
];

function vagueFood(need: Attrs): string | null {
  const core = need.core.trim();
  return VAGUE_FOODS.find((v) => v.core.test(core))?.kind ?? null;
}

function kindOf(kind: string, name: string): string {
  const row = VAGUE_FOODS.find((v) => v.kind === kind);
  return row?.kinds.exec(norm(name))?.[1] ?? "";
}

const HEAVY = /^(different|cut:|cut not stated|frozen|canned|dried|not ground|ground,|not named|contains|no .* in the name|aisle|frozen aisle|not a meat|marinated|seasoned|breaded|cooked|smoked|stuffed|spicy|burger|deli|meal|sauce|soup|snack|plant|instant|with extras|concentrated)/;

/** Wrong animal, cut or form weighs more than a missing word when ordering choices. */
function severity(differs: string[]): number {
  // "different product" means the words overlap but it's another food (soy milk for soy sauce): rank it last.
  return differs.reduce((n, d) => n + (d === "different product" ? 5 : HEAVY.test(d) ? 3 : 1), 0);
}

function labelBoneSkin(name: string): string {
  const a = parseAttrs(name);
  return [a.bone ?? "bone not stated", a.skin ?? "skin not stated"].join(", ");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
