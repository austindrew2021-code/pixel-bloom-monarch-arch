// k3 SAFETY (Kitchen, Nov 15): placeholder / allergen-only / mid-list placeholder
// text is not a real ingredient list (can only add refusals). Crabmeat / imitation /
// surimi / crab stick / flavoured / style are made-product markers. Squash or split
// title checks run only when there is no real list, split only at a made-product
// suffix, and matches are word-boundary only. With a real list, judge on the list
// plus raw-title word boundaries, as on 814f702.
import assert from "node:assert/strict";
import test from "node:test";
import { liveStoreResult } from "./grocery-pcx.server.ts";
import {
  isMadeProductTitle,
  isRealIngredientList,
  pickExact,
  shieldBlocks,
  type MatchProduct,
} from "./grocery-match.ts";
import type { CartNeed } from "./grocery-pick.ts";

const L = (name: string, qty: number, unit: string, aisle = "Pantry") => ({ name, qty, unit, aisle }) as CartNeed;
const P = (name: string, sizeLabel: string, priceCad: number, extra: Partial<MatchProduct> = {}) =>
  ({ brand: "superstore", name, sizeLabel, priceCad, ingredients: "", ...extra }) as unknown as MatchProduct;

const EIGHT = ["gluten", "dairy", "nuts", "shellfish", "egg", "soy", "sesame", "fish"] as const;
const DIETS = ["vegan", "vegetarian", "pescatarian"] as const;
const ALL8_PLUS = [...EIGHT, ...DIETS];
const JOINED_PASTES = ["Shrimppaste", "Crabpaste", "Lobsterpaste", "Clampaste", "Oysterpaste", "Prawnpaste", "Salmonpaste"] as const;
const PLACEHOLDERS = ["—", "-", "–", "...", "n/a", "na", "none", "nil", "not available", "not applicable", "unavailable", "unknown", "see package", "see packaging", "see label", "tbd", "null", "undefined", "", "N/A", "Not available", "Ingredients: —", "Ingredients: N/A"];

function hits(product: MatchProduct, profile: { allergies?: string[]; prefs?: string[] }): string[] {
  return shieldBlocks(product, profile);
}
function refuses(product: MatchProduct, k: string): boolean {
  const profile = (["vegan", "vegetarian", "pescatarian", "gluten-free", "dairy-free", "sugar-free"] as string[]).includes(k)
    ? { prefs: [k] }
    : { allergies: [k] };
  return hits(product, profile).length > 0;
}

test("k3-1: placeholder strings are not a real ingredient list", () => {
  for (const ph of PLACEHOLDERS) {
    assert.equal(isRealIngredientList(ph), false, JSON.stringify(ph));
  }
  assert.equal(isRealIngredientList("Tomatoes, salt."), true);
  assert.equal(isRealIngredientList("Ingredients: Tomatoes, salt."), true);
  assert.equal(isRealIngredientList("Shrimp, salt."), true);
});

test("k3-1: Basil Pesto with '—' fails nuts, dairy and vegan; Shrimp Paste with '—' or 'N/A' fails all tags", () => {
  const pestoDash = P("Basil Pesto", "200 g", 3.99, { ingredients: "—" });
  for (const k of ["nuts", "dairy", "vegan"] as const) {
    assert.ok(refuses(pestoDash, k), `Basil Pesto '—' must refuse ${k}`);
  }
  for (const ph of ["—", "N/A", "n/a", "-", "not available"]) {
    const shrimp = P("Shrimp Paste", "100 g", 2.99, { ingredients: ph });
    for (const k of ALL8_PLUS) {
      assert.ok(refuses(shrimp, k), `Shrimp Paste ${JSON.stringify(ph)} must refuse ${k}`);
    }
  }
});

test("k3-1a: a label of only allergen statements is no list; named allergens still refuse", () => {
  assert.equal(isRealIngredientList("Contains: milk, soy"), false);
  assert.equal(isRealIngredientList("May contain peanuts"), false);
  assert.equal(isRealIngredientList("Produced in a facility that processes milk and wheat."), false);
  const pesto = P("Basil Pesto", "200 g", 3.99, { ingredients: "Contains: milk, soy" });
  // Made-product + no real list: all 8 + vegan. Named allergens also refuse.
  for (const k of ["nuts", "dairy", "soy", "vegan", "gluten", "egg"] as const) {
    assert.ok(refuses(pesto, k), `pesto Contains: milk, soy must refuse ${k}`);
  }
  const granola = P("Plain Granola", "400 g", 4.99, { ingredients: "May contain peanuts" });
  assert.ok(refuses(granola, "nuts"), "may contain peanuts must refuse nuts");
  const facility = P("Basil Pesto", "200 g", 3.99, { ingredients: "Produced in a facility that processes milk." });
  assert.ok(refuses(facility, "dairy"));
  assert.ok(refuses(facility, "nuts"), "made product with no real list still fails nuts");
});

test("k3-1b: a placeholder phrase anywhere makes the list not real; words that appear still refuse", () => {
  const text = "Ingredients: see package. Shrimp";
  assert.equal(isRealIngredientList(text), false);
  const shrimp = P("Shrimp Paste", "100 g", 2.99, { ingredients: text });
  assert.ok(refuses(shrimp, "shellfish"), "shrimp in 'see package. Shrimp' must still refuse shellfish");
  for (const k of ALL8_PLUS) {
    assert.ok(refuses(shrimp, k), `see package. Shrimp must refuse ${k} (no real list, made product)`);
  }
  // A real list with a may-contain sentence is still a real list; may-contain still refuses.
  assert.equal(isRealIngredientList("Tomatoes, salt. May contain peanuts."), true);
  const tomato = P("Tomato Paste", "156 ml", 1.29, { ingredients: "Tomatoes, salt. May contain peanuts." });
  assert.ok(refuses(tomato, "nuts"));
  assert.equal(refuses(tomato, "gluten"), false, "real list with may-contain peanuts must not newly refuse gluten");
});

test("k3-2: Crabmeat, crab meat, imitation, surimi, crab sticks, flavoured/style are made products; no list fails all 8 + vegan/veg/pescatarian; Crabmeat also fails shellfish", () => {
  const titles = ["Crabmeat", "Crab Meat", "Imitation Crab", "Surimi", "Crab Sticks", "Crab Stick", "Flavoured Crab", "Flavored Whitefish", "Maryland-style Crab Cakes", "Buffalo style cauliflower"];
  for (const title of titles) {
    assert.equal(isMadeProductTitle(title), true, title);
    const p = P(title, "200 g", 4.99);
    for (const k of ALL8_PLUS) {
      assert.ok(refuses(p, k), `${title} with no list must refuse ${k}`);
    }
  }
  assert.ok(refuses(P("Crabmeat", "200 g", 4.99), "shellfish"));
  assert.ok(refuses(P("Crabmeat", "200 g", 4.99, { ingredients: "—" }), "shellfish"));
  // Clean crab list (two specific items: a made product needs more than "Crab."): still shellfish, pescatarian may pass (seafood).
  const clean = P("Crabmeat", "200 g", 4.99, { ingredients: "Crab, salt." });
  assert.ok(refuses(clean, "shellfish"));
  assert.ok(refuses(clean, "vegan"));
  assert.equal(refuses(clean, "pescatarian"), false, "clean Crabmeat still passes pescatarian");
  assert.equal(refuses(clean, "nuts"), false);
});

test("k3-3: joined pastes with no list still refuse every asked tag", () => {
  for (const title of JOINED_PASTES) {
    const p = P(title, "100 g", 2.99);
    for (const k of ALL8_PLUS) {
      assert.ok(refuses(p, k), `${title} must refuse ${k}`);
    }
  }
});

test("k3-3: clean-list friction items pass again (word-boundary only; no squash when a list is real)", () => {
  const cases: [string, string, string][] = [
    ["Chicken Fryer", "Chicken.", "gluten"],
    ["Whole Fryer Chicken", "Chicken.", "gluten"],
    ["Brandywine Tomatoes", "Tomatoes.", "gluten"],
    ["Veggie Burger", "Soy protein, vegetables, salt.", "egg"],
    ["Mixed Veggies", "Carrot, pea, corn.", "egg"],
    ["Parmigiano Reggiano", "Milk, salt, rennet.", "egg"],
    ["Pico de Gallo", "Tomato, onion, cilantro, lime, salt.", "fish"],
    ["Fortuna Olive Oil", "Olive oil.", "fish"],
    ["Meatless Crumbles", "Soy protein, salt.", "gluten"],
  ];
  for (const [title, list, mustPass] of cases) {
    const p = P(title, "1 ea", 3.99, { ingredients: list });
    assert.equal(isRealIngredientList(list), true, list);
    assert.equal(refuses(p, mustPass), false, `${title} with clean list must pass ${mustPass}`);
  }
  // Meatless Crumbles with a clean plant list also should not refuse vegan/veg/pescatarian via "meat" inside "meatless".
  const crumbles = P("Meatless Crumbles", "340 g", 5.99, { ingredients: "Soy protein, salt." });
  assert.equal(refuses(crumbles, "vegan"), false);
  assert.equal(refuses(crumbles, "vegetarian"), false);
  assert.equal(refuses(crumbles, "pescatarian"), false);
});

test("k3-3: a real list plus raw-title word-boundary matching is not loosened vs 814f702", () => {
  // Raw-title hits still fire when a clean list is present.
  const shrimp = P("Shrimp Paste", "100 g", 2.99, { ingredients: "Shrimp, salt." });
  assert.ok(refuses(shrimp, "shellfish"));
  assert.ok(refuses(shrimp, "vegan"));
  assert.equal(refuses(shrimp, "nuts"), false);
  assert.equal(refuses(shrimp, "pescatarian"), false);
  const soy = P("Kikkoman Soy Sauce", "591 ml", 5.5, { ingredients: "Water, soybeans, salt, wheat." });
  assert.ok(refuses(soy, "gluten"));
  assert.ok(refuses(soy, "soy"));
  // Whole foods with no list stay as before.
  assert.equal(refuses(P("Raw Shrimp", "400 g", 9.99), "pescatarian"), false);
  assert.ok(refuses(P("Raw Shrimp", "400 g", 9.99), "shellfish"));
  assert.equal(refuses(P("Atlantic Salmon Fillet", "454 g", 12.99), "pescatarian"), false);
  assert.equal(refuses(P("Whole Garlic", "3 ea", 1.49), "vegan"), false);
  assert.equal(refuses(P("Whole Garlic", "3 ea", 1.49), "nuts"), false);
});

test("k3-3: pickExact / live mock — placeholder detail and no-list Shrimppaste still refuse", async () => {
  const paste = P("Shrimppaste", "100 g", 2.99);
  const ok = pickExact({ line: L("shrimp paste", 1, "jar"), products: [paste] });
  assert.equal(ok.status, "pick");
  const blocked = pickExact({
    line: L("shrimp paste", 1, "jar"),
    products: [paste],
    profile: { allergies: ["shellfish"] },
  });
  assert.notEqual(blocked.status, "pick");
  assert.equal(blocked.pick ?? null, null);

  const store = { brand: "superstore" as const, name: "Atlantic Superstore" };
  const TEST_KEY = "unit-test-placeholder-key";
  function tile(title: string, size: string, price: number, brand = "") {
    let h = 7;
    for (const c of title + size) h = (h * 31 + c.charCodeAt(0)) | 0;
    return { productId: `${(h % 9_000_000) + 10_000_000}_EA`, brand, title, packageSizing: size, pricing: { price: String(price) } };
  }
  const realFetch = globalThis.fetch;
  const realKey = process.env.SPOONFUL_PCX_API_KEY;
  process.env.SPOONFUL_PCX_API_KEY = TEST_KEY;
  const shrimpTile = tile("Shrimppaste", "100 g", 2.99, "No Name");
  const pestoTile = tile("Basil Pesto", "200 g", 3.99, "No Name");
  try {
    // Details 404: still refuse (r4 live mock).
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes("/products/search")) {
        return new Response(JSON.stringify({ layout: { sections: { mainContentCollection: { components: [{ data: { productTiles: [shrimpTile] } }] } } } }), { status: 200 });
      }
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    const r404 = await liveStoreResult({
      store,
      line: { name: "shrimp paste", qty: 1, unit: "jar", aisle: "Pantry" },
      storeId: "0357",
      profile: { allergies: ["shellfish"] },
    });
    assert.notEqual(r404.status, "pick");
    assert.equal(r404.options.length, 0);

    // Details return a placeholder list: Basil Pesto + "—" must refuse nuts.
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes("/products/search")) {
        return new Response(JSON.stringify({ layout: { sections: { mainContentCollection: { components: [{ data: { productTiles: [pestoTile] } }] } } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ingredients: "—", breadcrumbs: [{ name: "Food" }] }), { status: 200 });
    }) as typeof fetch;
    const rPh = await liveStoreResult({
      store,
      line: { name: "basil pesto", qty: 1, unit: "jar", aisle: "Pantry" },
      storeId: "0357",
      profile: { allergies: ["nuts"] },
    });
    assert.notEqual(rPh.status, "pick", `pesto with '—' must refuse nuts, got ${rPh.status} ${rPh.options[0]?.name ?? ""} ${rPh.reason}`);
    assert.equal(rPh.options.length, 0);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.SPOONFUL_PCX_API_KEY;
    else process.env.SPOONFUL_PCX_API_KEY = realKey;
  }
});
