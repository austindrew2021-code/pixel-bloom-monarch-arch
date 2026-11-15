// k5 r2 SAFETY: restore modifier/joiner-only filler alongside any-filler-word;
// split list items only on commas/semicolons at bracket depth 0. The allergen
// check still reads the full raw text. LOW cases (sauce tomate, rosemary
// extract, herbes de Provence) stay filler.
import assert from "node:assert/strict";
import test from "node:test";
import {
  isFillerItem,
  isRealIngredientList,
  splitListItems,
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

test("k5-r2-1: modifier- or joiner-only items are filler; any filler word still is; whole-word only", () => {
  for (const item of [
    "natural", "naturals", "artificial", "other", "fines", "agents",
    "naturel", "naturels", "artificiel", "artificiels",
    "autre", "autres",
    "and", "et", "or", "ou", "with", "avec",
    "natural and artificial", "natural & artificial",
    "Flavour (natural, artificial)", "Arômes (naturels, artificiels)",
    // k5 any-filler-word rule still applies
    "Caramel colour", "Colour (caramel)", "Natural flavour (vanilla)",
    "sauce tomate", "rosemary extract", "herbes de Provence",
  ]) {
    assert.equal(isFillerItem(item), true, item);
  }
  assert.equal(isFillerItem("salt"), false);
  assert.equal(isFillerItem("Basil"), false);
  assert.equal(isFillerItem("garlic salt"), false);
  assert.equal(isFillerItem("spiced"), false);
  assert.equal(isFillerItem("flavoured"), false);
});

test("k5-r2-2: list items split only on commas and semicolons at bracket depth 0", () => {
  assert.deepEqual(splitListItems("Flavour (natural, artificial), salt."), [
    "Flavour (natural, artificial)",
    "salt.",
  ]);
  assert.deepEqual(splitListItems("Arômes (naturels, artificiels), sel."), [
    "Arômes (naturels, artificiels)",
    "sel.",
  ]);
  assert.deepEqual(splitListItems("Spices (mustard, sesame)"), [
    "Spices (mustard, sesame)",
  ]);
  assert.deepEqual(splitListItems("Basil, flavour (natural, artificial)."), [
    "Basil",
    "flavour (natural, artificial).",
  ]);
  assert.deepEqual(splitListItems("Natural flavour (contains milk); salt."), [
    "Natural flavour (contains milk)",
    "salt.",
  ]);
});

test("k5-r2-3: Line's modifier/joiner lists refuse on pesto, crab cakes, egg rolls, ranch and taco seasoning", () => {
  const lists = [
    "Flavour (natural, artificial), salt.",
    "Arômes (naturels, artificiels), sel.",
    "Basil, flavour (natural, artificial).",
    "Basil, natural.",
    "Basil, other.",
    "Natural, salt.",
  ];
  for (const list of lists) {
    assert.equal(isRealIngredientList(list, "Basil Pesto"), false, list);
    assert.ok(refuses("Basil Pesto", list, "nuts"), `pesto ${list} nuts`);
    assert.ok(refuses("Basil Pesto", list, "dairy"), `pesto ${list} dairy`);
    assert.ok(refuses("Basil Pesto", list, "vegan"), `pesto ${list} vegan`);
    assert.ok(refuses("Crab Cakes", list, "gluten"), `crab ${list} gluten`);
    assert.ok(refuses("Egg Rolls", list, "gluten"), `rolls ${list} gluten`);
    assert.ok(refuses("Ranch Dip", list, "dairy"), `ranch ${list} dairy`);
    assert.ok(refuses("Ranch Dip", list, "egg"), `ranch ${list} egg`);
    assert.ok(refuses("Taco Seasoning", list, "gluten"), `taco ${list} gluten`);
  }
  // Two specific items still count.
  assert.equal(isRealIngredientList("Basil, canola oil, salt.", "Basil Pesto"), true);
  assert.equal(refuses("Basil Pesto", "Basil, canola oil, salt.", "gluten"), false);
});

test("k5-r2-4: allergen check still reads the full raw text, including brackets", () => {
  const cases: Array<[string, string]> = [
    ["Spices (mustard, sesame)", "sesame"],
    ["Almond extract", "nuts"],
    ["Soy sauce", "soy"],
    ["Natural flavour (contains milk)", "dairy"],
  ];
  for (const [item, tag] of cases) {
    assert.equal(isFillerItem(item), true, item);
    assert.ok(refuses("Basil Pesto", `${item}.`, tag), `pesto only ${item} ${tag}`);
    assert.ok(refuses("Gala Apples", `${item}.`, tag), `apples only ${item} ${tag}`);
    const alongside = `Basil, canola oil, ${item}.`;
    assert.equal(isRealIngredientList(alongside, "Basil Pesto"), true, alongside);
    assert.ok(refuses("Basil Pesto", alongside, tag), `pesto alongside ${item} ${tag}`);
    assert.equal(refuses("Basil Pesto", alongside, "shellfish"), false, `pesto alongside ${item} must pass shellfish`);
  }
});
