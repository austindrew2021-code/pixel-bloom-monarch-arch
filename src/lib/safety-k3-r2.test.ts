// k3 r2 SAFETY: joined stems always run on title and list (add-only);
// French allergen lexicon; real list is positive recognition (two items, or one
// honest food item when no referral was stripped); placeholders never void a
// real list by substring.
import assert from "node:assert/strict";
import test from "node:test";
import {
  isRealIngredientList,
  shieldBlocks,
  type MatchProduct,
} from "./grocery-match.ts";

const P = (name: string, ingredients: string | undefined, extra: Partial<MatchProduct> = {}) =>
  ({ brand: "superstore", name, sizeLabel: "1 ea", priceCad: 1, ...(ingredients !== undefined ? { ingredients } : {}), ...extra }) as unknown as MatchProduct;

function refuses(name: string, ingredients: string | undefined, k: string): boolean {
  const profile = (["vegan", "vegetarian", "pescatarian", "gluten-free", "dairy-free", "sugar-free"] as string[]).includes(k)
    ? { prefs: [k] }
    : { allergies: [k] };
  return shieldBlocks(P(name, ingredients), profile).length > 0;
}

test("k3-r2-1: joined fish/shellfish species refuse fish or shellfish on title and on the list", () => {
  for (const title of ["Catfish Fillets", "Swordfish Steak", "Whitefish Fillet", "Monkfish", "Kingfish", "Bluefish", "Lingcod Fillet", "Blackcod", "Codfish", "Salt Codfish", "Codfish Fillets", "Codfish Cakes", "Tunafish"]) {
    for (const list of [undefined, "—", title.replace(/ Fillets| Steak| Fillet| Cakes| Salt /g, "").trim() + "."]) {
      assert.ok(refuses(title, list, "fish"), `${title} [${list}] must refuse fish`);
    }
  }
  assert.ok(refuses("Catfish Fillets", "Catfish.", "vegan"));
  assert.ok(refuses("Catfish Fillets", "Catfish.", "vegetarian"));
  assert.ok(refuses("Swordfish Steak", "Swordfish.", "vegan"));
  assert.ok(refuses("Catfish Fillets", "Poisson-chat.", "fish"));
  assert.ok(refuses("Codfish", "Morue, sel.", "fish"));
  assert.ok(refuses("Tunafish", "Thon, eau, sel.", "fish"));
  for (const [title, list] of [["Snowcrab Legs", "Snowcrab."], ["Kingcrab Legs", "Kingcrab."], ["Lobstertails", "Lobstertails."]] as const) {
    assert.ok(refuses(title, list, "shellfish"), `${title} must refuse shellfish`);
  }
});

test("k3-r2-1: Codfish with no list or a dash list fails fish (and the live-route titles)", () => {
  for (const title of ["Codfish", "Salt Codfish", "Codfish Fillets", "Codfish Cakes"]) {
    assert.ok(refuses(title, undefined, "fish"), `${title} no list`);
    assert.ok(refuses(title, "—", "fish"), `${title} dash`);
  }
});

test("k3-r2-1: joined titles with a French or clean list still refuse from the title stem", () => {
  assert.ok(refuses("Shrimppaste", "Crevettes, sel.", "shellfish"));
  assert.ok(refuses("Prawncrackers", "Amidon de tapioca, crevettes, sucre.", "shellfish"));
  assert.ok(refuses("Fishsauce", "Anchois, sel, sucre.", "fish"));
  assert.ok(refuses("Oystersauce", "Eau, sucre, extrait d'huîtres, sel.", "shellfish"));
  assert.ok(refuses("Eggnoodles", "Semoule de blé dur, oeufs.", "egg"));
  assert.ok(refuses("Eggnoodles", "Semoule de blé dur, oeufs.", "gluten"));
  assert.ok(refuses("Soymilk", "Sugar, water, salt.", "soy"));
  assert.ok(refuses("Crabmeat", "Sugar, water, salt.", "shellfish"));
});

test("k3-r2-1: lookalike exclusions keep the k3 friction fixes passing on a clean list", () => {
  assert.equal(refuses("Chicken Fryer", "Chicken, salt.", "gluten"), false);
  assert.equal(refuses("Whole Fryer Chicken", "Chicken, salt.", "gluten"), false);
  assert.equal(refuses("Brandywine Tomatoes", "Tomatoes, salt.", "gluten"), false);
  assert.equal(refuses("Veggie Burger", "Soy protein, vegetables, salt.", "egg"), false);
  assert.equal(refuses("Mixed Veggies", "Carrot, pea, corn.", "egg"), false);
  assert.equal(refuses("Parmigiano Reggiano", "Milk, salt, rennet.", "egg"), false);
  assert.equal(refuses("Pico de Gallo", "Tomato, onion, cilantro, lime, salt.", "fish"), false);
  assert.equal(refuses("Fortuna Olive Oil", "Olive oil, salt.", "fish"), false);
  assert.equal(refuses("Meatless Crumbles", "Soy protein, salt.", "gluten"), false);
  assert.equal(refuses("Italian Eggplant", undefined, "egg"), false);
  assert.equal(refuses("Crabapple Jelly", "Crabapples, sugar, pectin.", "shellfish"), false);
  assert.equal(refuses("Oyster Mushroom", undefined, "shellfish"), false);
});

test("k3-r2-2: French allergen lexicon maps to the English tags", () => {
  const cases: [string, string, string][] = [
    ["Crevettes, sel.", "shellfish", "Crevettes"],
    ["Crabe, sel.", "shellfish", "Crabe"],
    ["Homard, beurre.", "shellfish", "Homard"],
    ["Morue, sel.", "fish", "Morue"],
    ["Thon, eau, sel.", "fish", "Thon"],
    ["Poisson, sel.", "fish", "Poisson"],
    ["Saumon, sel.", "fish", "Saumon"],
    ["Farine, oeufs, sel.", "egg", "oeufs"],
    ["Semoule de blé dur, eau.", "gluten", "blé"],
    ["Seigle, eau, sel.", "gluten", "seigle"],
    ["Orge, eau, sel.", "gluten", "orge"],
    ["Eau, soja, sel.", "soy", "soja"],
    ["Lait, sucre.", "dairy", "lait"],
    ["Beurre, sel.", "dairy", "beurre"],
    ["Fromage, sel.", "dairy", "fromage"],
    ["Crème, sucre.", "dairy", "crème"],
    ["Arachides, sel.", "nuts", "arachides"],
    ["Noix, sel.", "nuts", "noix"],
    ["Amandes, sel.", "nuts", "amandes"],
    ["Noisettes, sel.", "nuts", "noisettes"],
    ["Sésame, sel.", "sesame", "sésame"],
    ["Fruits de mer, sel.", "shellfish", "fruits de mer"],
    ["Mollusques, sel.", "shellfish", "mollusques"],
    ["Crustacés, sel.", "shellfish", "crustacés"],
  ];
  for (const [list, tag, word] of cases) {
    assert.ok(refuses("Prepared Food", list, tag), `${word} in "${list}" must refuse ${tag}`);
  }
  // Coconut lookalikes in French do not trip dairy or nuts.
  assert.equal(refuses("Boisson", "Eau, lait de coco, sel.", "dairy"), false);
  assert.equal(refuses("Dessert", "Sucre, noix de coco, sel.", "nuts"), false);
});

test("k3-r2-3: real list is positive recognition; these phrases are no list; named allergens still refuse", () => {
  const nolist = [
    "Not listed", "Ingredients not listed", "Refer to packaging", "Please refer to the product label",
    "See product packaging for most accurate ingredients", "Information not provided", "No information",
    "TBA", "Pending", "Coming soon", "Varies", "Non disponible", "Ingrédients : non disponibles",
    "see package. Shrimp", "Contains: milk, soy", "May contain peanuts",
  ];
  for (const ph of nolist) {
    assert.equal(isRealIngredientList(ph), false, JSON.stringify(ph));
    assert.ok(refuses("Basil Pesto", ph, "nuts"), `Basil Pesto ${JSON.stringify(ph)} must refuse nuts`);
  }
  assert.ok(refuses("Shrimp Paste", "see package. Shrimp", "shellfish"));
  assert.ok(refuses("Shrimp Paste", "see package. Shrimp", "nuts"));
  assert.ok(refuses("Plain Granola", "May contain peanuts", "nuts"));
  assert.ok(refuses("Basil Pesto", "Contains: milk, soy", "dairy"));
  assert.ok(refuses("Basil Pesto", "Contains: milk, soy", "soy"));
  assert.equal(isRealIngredientList("Tomatoes, salt."), true);
  assert.equal(isRealIngredientList("Tomatoes."), true);
  assert.equal(isRealIngredientList("Olive oil."), true);
  assert.equal(isRealIngredientList("Ingredients: Tomatoes, salt."), true);
});

test("k3-r2-4: placeholders never void a real list by substring; statements do not relax a made product", () => {
  assert.equal(isRealIngredientList("Water, tomatoes, salt, sodium (Na) 200 mg"), true);
  assert.equal(isRealIngredientList("Sodium (Na) 200 mg"), false);
  assert.ok(refuses("Basil Pesto", "Sodium (Na) 200 mg", "nuts"), "nutrition-only line is no list");
  assert.equal(isRealIngredientList("Basil, canola oil, salt - see package for allergens"), true);
  assert.equal(refuses("Basil Pesto", "Basil, canola oil, salt - see package for allergens", "nuts"), false);
  assert.equal(isRealIngredientList("Water, salt. Contains none of the priority allergens."), true);
  assert.equal(isRealIngredientList("Pork, salt, sodium nitrite. None."), true);
  // The statement alone is not a list and never relaxes a made product.
  assert.equal(isRealIngredientList("Contains none of the priority allergens"), false);
  assert.ok(refuses("Basil Pesto", "Contains none of the priority allergens", "nuts"));
});
