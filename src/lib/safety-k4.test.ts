// k4 SAFETY: filler phrases (accents, plurals, and/et/&/with, colour/condiment);
// cake/tempura/dumpling/roll/fritter/nugget/battered/breaded/fish stick(s)/fish finger(s)
// are made-product words; a clean real list still decides joined cake/bun forms.
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

const ALL8_PLUS = ["gluten","dairy","nuts","shellfish","spicy","egg","soy","sesame","fish","vegan","vegetarian","pescatarian","gluten-free","dairy-free","sugar-free"] as const;

test("k4-1: filler matching is case-, accent- and plural-insensitive; joined filler phrases are filler", () => {
  for (const item of [
    "Arômes naturels", "aromes naturels", "ARÔMES NATURELS", "arôme naturel",
    "natural and artificial flavours", "Natural & artificial flavors",
    "Spices and herbs", "spices et herbes", "spices with herbs",
    "colour", "color", "colours", "Colouring", "colorant",
    "condiments", "spice blend", "extracts", "flavouring agent",
    "épices", "Épices", "fines herbes",
  ]) {
    assert.equal(isFillerItem(item), true, item);
  }
  assert.equal(isFillerItem("salt"), false);
  assert.equal(isFillerItem("Basil"), false);
  assert.equal(isFillerItem("tomato sauce"), true);
  assert.equal(isFillerItem("garlic salt"), false);
  assert.equal(isFillerItem("vanilla extract"), true);
});

test("k4-1: filler plus salt is one specific item; Line's lists refuse on pesto, ranch and taco seasoning", () => {
  const lists = [
    "Arômes naturels, sel.",
    "Basil, natural and artificial flavours.",
    "Colour, salt.",
    "Basil, color",
    "Spices and herbs, salt.",
    "Basil, condiments.",
    "Basil, arômes naturels.",
    "Basil, colour.",
    "Basil, spices and herbs.",
    "Spices, sauce.",
    "Basil, seasoning.",
    "Herbs, natural flavour.",
    "Spices, salt.",
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
  // Two specific items still count.
  assert.equal(isRealIngredientList("Basil, canola oil, salt.", "Basil Pesto"), true);
  assert.equal(refuses("Basil Pesto", "Basil, canola oil, salt.", "gluten"), false);
});

test("k4-2: cake, tempura, dumpling, roll, fritter, nugget, battered, breaded, fish stick/finger are made products; no list fails every tag", () => {
  const titles = ["Crab Cakes", "Crab Cake", "Salmon Cakes", "Shrimp Tempura", "Shrimp Dumplings", "Egg Rolls", "Egg Roll", "Fish Sticks", "Fish Fingers", "Chicken Nuggets", "Apple Fritters", "Battered Shrimp", "Breaded Shrimp"];
  for (const title of titles) {
    assert.equal(isMadeProductTitle(title), true, title);
    for (const k of ALL8_PLUS) {
      assert.ok(refuses(title, undefined, k), `${title} no list must refuse ${k}`);
    }
  }
  // Rolled oats and similar lookalikes are not a made-product "roll".
  assert.equal(isMadeProductTitle("Rolled Oats"), false);
  assert.equal(isMadeProductTitle("Rolled oats"), false);
  // "oats" still hits gluten on the title. With a real list, other tags stay clean.
  assert.ok(refuses("Rolled Oats", undefined, "gluten"), "rolled oats still refuse gluten (oats)");
  assert.equal(refuses("Rolled Oats", "Oats.", "nuts"), false);
  assert.equal(refuses("Rolled Oats", "Oats.", "shellfish"), false);
  // A real clean list still decides: spaced made dishes with a clean gluten-free list pass gluten
  // only when the title itself has no gluten word; Crab Cakes with a clean list still fail shellfish.
  assert.ok(refuses("Crab Cakes", "Crab, salt, oil.", "shellfish"));
  assert.equal(refuses("Crab Cakes", "Crab, salt, oil.", "gluten"), false);
  assert.equal(refuses("Crab Cakes", "Crab, salt, oil.", "nuts"), false);
});

test("k4-3: joined cake/bun/roll forms with a clean list are unchanged (the list decides)", () => {
  // Spaced and joined cake/bun forms with a real clean list do not newly refuse gluten
  // (these suffixes are not SHIELD_RE gluten words; ruling 3 leaves that alone).
  for (const title of ["Ricecake", "Rice Cake", "Cheesecake", "Pancake", "Cupcake"]) {
    assert.equal(refuses(title, "Sugar, water, salt.", "gluten"), false, title);
  }
});
