// k5 SAFETY: an item that contains a filler word anywhere is filler for the
// made-product two-item count (qualifiers and brackets included). The allergen
// check still reads the full raw text of every item. Plain-food one-item
// rule and made-product "roll" are unchanged.
import assert from "node:assert/strict";
import test from "node:test";
import {
  isFillerItem,
  isMadeProductTitle,
  isRealIngredientList,
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

test("k5-1: an item that contains a filler word anywhere is filler; whole-word only", () => {
  for (const item of [
    "Caramel colour", "Caramel color", "Couleur caramel",
    "Colour (caramel)", "Colorant (caramel)", "Colour (beta-carotene)",
    "Natural flavour (vanilla)", "Spices (paprika)",
    "Spice extractives", "extractive", "extractives",
    "couleur", "couleurs",
    // k4 phrases still filler
    "Arômes naturels", "natural and artificial flavours", "Spices and herbs",
  ]) {
    assert.equal(isFillerItem(item), true, item);
  }
  // Whole-word only: "spiced" / "flavoured" keep existing behaviour (not filler words).
  assert.equal(isFillerItem("spiced"), false);
  assert.equal(isFillerItem("flavoured"), false);
  assert.equal(isFillerItem("spiced peanuts"), false);
  assert.equal(isFillerItem("flavoured almonds"), false);
  assert.equal(isFillerItem("salt"), false);
  assert.equal(isFillerItem("Basil"), false);
  assert.equal(isFillerItem("garlic salt"), false);
});

test("k5-1: Line's six lists and the four colour watch cases refuse on pesto, ranch and taco seasoning", () => {
  const lists = [
    "Caramel colour, salt.",
    "Colour (caramel), salt.",
    "Couleur caramel, sel.",
    "Natural flavour (vanilla), salt.",
    "Spices (paprika), salt.",
    "Spice extractives, salt.",
  ];
  for (const list of lists) {
    assert.equal(isRealIngredientList(list, "Basil Pesto"), false, list);
    assert.ok(refuses("Basil Pesto", list, "nuts"), `pesto ${list} nuts`);
    assert.ok(refuses("Basil Pesto", list, "dairy"), `pesto ${list} dairy`);
    assert.ok(refuses("Basil Pesto", list, "vegan"), `pesto ${list} vegan`);
    assert.ok(refuses("Ranch Dip", list, "dairy"), `ranch ${list} dairy`);
    assert.ok(refuses("Ranch Dip", list, "egg"), `ranch ${list} egg`);
    assert.ok(refuses("Taco Seasoning", list, "gluten"), `taco ${list} gluten`);
  }
  // The four shield-k4 WATCH colour cases (Basil Pesto × nuts/dairy).
  for (const list of ["Caramel colour, salt.", "Colour (caramel), salt."]) {
    assert.ok(refuses("Basil Pesto", list, "nuts"), `watch ${list} nuts`);
    assert.ok(refuses("Basil Pesto", list, "dairy"), `watch ${list} dairy`);
  }
  // Two specific items still count, and a real clean list still decides.
  assert.equal(isRealIngredientList("Basil, canola oil, salt.", "Basil Pesto"), true);
  assert.equal(refuses("Basil Pesto", "Basil, canola oil, salt.", "gluten"), false);
});

test("k5-1: filler status only affects the two-item count; the allergen check still reads every item, including brackets", () => {
  const cases: Array<[string, string]> = [
    ["Spices (mustard, sesame)", "sesame"],
    ["Almond extract", "nuts"],
    ["Soy sauce", "soy"],
    ["Natural flavour (contains milk)", "dairy"],
  ];
  for (const [item, tag] of cases) {
    assert.equal(isFillerItem(item), true, item);
    // As the only item, on a made product (doubt or the named allergen) and on a plain food.
    assert.ok(refuses("Basil Pesto", `${item}.`, tag), `pesto only ${item} ${tag}`);
    assert.ok(refuses("Gala Apples", `${item}.`, tag), `apples only ${item} ${tag}`);
    // Alongside other items, with two specific non-filler items so the list is real
    // (doubt is off). The named allergen must still come from the raw item text.
    const alongside = `Basil, canola oil, ${item}.`;
    assert.equal(isRealIngredientList(alongside, "Basil Pesto"), true, alongside);
    assert.ok(refuses("Basil Pesto", alongside, tag), `pesto alongside ${item} ${tag}`);
    // The real list is honest: a tag the item does not name still passes.
    // (Soy sauce also hits the existing prepared-sauce gluten rule, so this
    // check uses shellfish, which none of the four items name.)
    assert.equal(refuses("Basil Pesto", alongside, "shellfish"), false, `pesto alongside ${item} must pass shellfish`);
  }
});

test("k5: plain-food one-item rule and made-product roll are unchanged", () => {
  assert.equal(isRealIngredientList("Tomatoes.", "Gala Apples"), true);
  assert.equal(isRealIngredientList("Olive oil.", "Fortuna Olive Oil"), true);
  assert.equal(refuses("Gala Apples", "Tomatoes.", "nuts"), false);
  assert.equal(isMadeProductTitle("Egg Rolls"), true);
  assert.equal(isMadeProductTitle("Rolled Oats"), false);
  assert.equal(isMadeProductTitle("Pork Shoulder Roll"), true);
  // A whole-meat roll with a clean real list still decides.
  assert.equal(refuses("Pork Shoulder Roll", "Pork, salt, water.", "gluten"), false);
  assert.ok(refuses("Pork Shoulder Roll", undefined, "gluten"));
});
