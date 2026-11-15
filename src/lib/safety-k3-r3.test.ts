// k3 r3 SAFETY: joined gluten suffixes match spaced forms; French plant-dairy
// exclusions are dairy-only; a made product needs two specific (non-filler) items.
import assert from "node:assert/strict";
import test from "node:test";
import {
  isRealIngredientList,
  isMadeProductTitle,
  shieldBlocks,
  type MatchProduct,
} from "./grocery-match.ts";

const P = (name: string, ingredients: string | undefined) =>
  ({ brand: "superstore", name, sizeLabel: "1 ea", priceCad: 1, ...(ingredients !== undefined ? { ingredients } : {}) }) as unknown as MatchProduct;

function refuses(name: string, ingredients: string | undefined, k: string): boolean {
  const profile = (["vegan", "vegetarian", "pescatarian", "gluten-free", "dairy-free", "sugar-free"] as string[]).includes(k)
    ? { prefs: [k] }
    : { allergies: [k] };
  return shieldBlocks(P(name, ingredients), profile).length > 0;
}

test("k3-r3-1: joined gluten words refuse like the spaced forms, with or without a real list", () => {
  for (const [joined, spaced] of [
    ["Eggnoodles", "Egg Noodles"],
    ["Prawncrackers", "Prawn Crackers"],
    ["Walnutbread", "Walnut Bread"],
    ["Ricecrackers", "Rice Crackers"],
  ] as const) {
    for (const list of [undefined, "—", "Sugar, water, salt.", "Rice, salt."]) {
      assert.ok(refuses(joined, list, "gluten"), `${joined} [${list}] must refuse gluten`);
      assert.ok(refuses(joined, list, "gluten-free"), `${joined} [${list}] must refuse gluten-free`);
      assert.equal(refuses(joined, list, "gluten"), refuses(spaced, list, "gluten"), `${joined} vs ${spaced} gluten [${list}]`);
    }
  }
  // Existing lookalikes stay passing.
  assert.equal(refuses("Buckwheat Groats", "Buckwheat.", "gluten"), false);
  assert.equal(refuses("Italian Eggplant", "Eggplant.", "egg"), false);
  assert.equal(refuses("Cauliflower", undefined, "gluten"), false);
  assert.equal(refuses("Chicken Fryer", "Chicken, salt.", "gluten"), false);
});

test("k3-r3-2: plant-dairy exclusions apply only to dairy; nut words in those phrases still refuse nuts", () => {
  assert.ok(refuses("Granola", "Avoine, lait d'amande, sucre.", "nuts"));
  assert.ok(refuses("Spread", "beurre de cajou, sel", "nuts"));
  assert.ok(refuses("Spread", "Beurre d'amande, sel.", "nuts"));
  assert.ok(refuses("Cheese Alternative", "fromage d'amande, sel", "nuts"));
  assert.ok(refuses("Creamer", "Crème de cajou, eau.", "nuts"));
  // Dairy still ignores the plant phrases.
  assert.equal(refuses("Boisson", "Eau, lait de coco, sel.", "dairy"), false);
  assert.equal(refuses("Boisson", "Eau, lait d'amande, sel.", "dairy"), false);
  assert.equal(refuses("Spread", "beurre de cajou, sel", "dairy"), false);
  assert.equal(refuses("Dessert", "Sucre, noix de coco, sel.", "nuts"), false);
  assert.equal(refuses("Dessert", "Sucre, noix de coco, sel.", "dairy"), false);
  // Exclusion-abuse checks from Line's report still refuse.
  assert.ok(refuses("Lait", "Lait.", "dairy"));
  assert.ok(refuses("Cream", "Crème, sucre.", "dairy"));
  assert.ok(refuses("Cream", "crème fraîche", "dairy"));
  assert.ok(refuses("Milk", "lait de vache", "dairy"));
  assert.ok(refuses("Nuts", "noix de cajou, sel", "nuts"));
  assert.ok(refuses("Nuts", "noix de pécan, sel", "nuts"));
  assert.ok(refuses("Nuts", "Noix, sel.", "nuts"));
  assert.ok(refuses("Mix", "lait de coco, lait", "dairy"));
  assert.ok(refuses("Mix", "Coconut milk, milk", "dairy"));
});

test("k3-r3-3: a made product needs two specific items; one item or fillers-only is no list", () => {
  assert.equal(isMadeProductTitle("Basil Pesto"), true);
  assert.equal(isMadeProductTitle("Ranch Dip"), true);
  assert.equal(isMadeProductTitle("Taco Seasoning"), true);
  assert.equal(isMadeProductTitle("Shrimp Paste"), true);
  for (const list of ["Basil.", "Sauce.", "Spices."]) {
    assert.equal(isRealIngredientList(list, "Basil Pesto"), false, list);
    assert.ok(refuses("Basil Pesto", list, "nuts"), `pesto ${list} nuts`);
    assert.ok(refuses("Basil Pesto", list, "dairy"), `pesto ${list} dairy`);
    assert.ok(refuses("Basil Pesto", list, "vegan"), `pesto ${list} vegan`);
  }
  assert.ok(refuses("Ranch Dip", "Spices.", "dairy"));
  assert.ok(refuses("Ranch Dip", "Spices.", "egg"));
  assert.ok(refuses("Taco Seasoning", "Spices.", "gluten"));
  assert.ok(refuses("Shrimp Paste", "Spices.", "fish"));
  assert.ok(refuses("Shrimp Paste", "Spices.", "nuts"));
  // Fillers do not count toward the 2-item minimum on a made product.
  for (const list of ["Spices, sauce.", "Basil, seasoning.", "Herbs, natural flavour.", "Spices, salt."]) {
    assert.equal(isRealIngredientList(list, "Basil Pesto"), false, list);
    assert.ok(refuses("Basil Pesto", list, "nuts"), `pesto ${list} nuts`);
    assert.ok(refuses("Basil Pesto", list, "dairy"), `pesto ${list} dairy`);
    assert.ok(refuses("Basil Pesto", list, "vegan"), `pesto ${list} vegan`);
    assert.ok(refuses("Ranch Dip", list, "dairy"), `ranch ${list} dairy`);
    assert.ok(refuses("Ranch Dip", list, "egg"), `ranch ${list} egg`);
    assert.ok(refuses("Taco Seasoning", list, "gluten"), `taco ${list} gluten`);
  }
  // A real two-specific-item list still counts, including after a referral / statement.
  assert.equal(isRealIngredientList("Basil, canola oil, salt.", "Basil Pesto"), true);
  assert.equal(isRealIngredientList("Basil, canola oil, salt - see package for allergens", "Basil Pesto"), true);
  assert.equal(refuses("Basil Pesto", "Basil, canola oil, salt.", "nuts"), false);
  // Plain non-made foods keep the one-honest-item rule.
  assert.equal(isMadeProductTitle("Tomatoes"), false);
  assert.equal(isRealIngredientList("Tomatoes.", "Tomatoes"), true);
  assert.equal(isRealIngredientList("Olive oil.", "Fortuna Olive Oil"), true);
  assert.equal(isRealIngredientList("Spices, salt.", "Gala Apples"), true, "plain foods unchanged");
});
