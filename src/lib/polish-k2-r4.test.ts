// k2 r4 (Kitchen SAFETY, Nov 15): product allergy/diet checks the raw title, the
// split/normalized title, and a squashed form (refusal from any form wins;
// splitting only adds refusals). A made-product word is never a whole food;
// with no ingredient list it fails all 8 tags (block when in doubt). Form/size
// matching is unchanged.
import assert from "node:assert/strict";
import test from "node:test";
import { liveStoreResult } from "./grocery-pcx.server.ts";
import {
  isMadeProductTitle,
  pickExact,
  shieldBlocks,
  UNCHECKED_LABEL_REASON,
  type MatchProduct,
} from "./grocery-match.ts";
import type { CartNeed } from "./grocery-pick.ts";

const L = (name: string, qty: number, unit: string, aisle = "Pantry") => ({ name, qty, unit, aisle }) as CartNeed;
const P = (name: string, sizeLabel: string, priceCad: number, extra: Partial<MatchProduct> = {}) =>
  ({ brand: "superstore", name, sizeLabel, priceCad, ingredients: "", ...extra }) as unknown as MatchProduct;

const EIGHT = ["gluten", "dairy", "nuts", "shellfish", "egg", "soy", "sesame", "fish"] as const;
const JOINED_PASTES = ["Shrimppaste", "Crabpaste", "Lobsterpaste", "Clampaste", "Oysterpaste", "Prawnpaste", "Salmonpaste"] as const;
const PROFILES: { label: string; profile: { allergies?: string[]; prefs?: string[] } }[] = [
  ...EIGHT.map((id) => ({ label: id, profile: { allergies: [id] } })),
  { label: "vegan", profile: { prefs: ["vegan"] } },
  { label: "pescatarian", profile: { prefs: ["pescatarian"] } },
];

function hits(product: MatchProduct, profile: { allergies?: string[]; prefs?: string[] }): string[] {
  return shieldBlocks(product, profile);
}

test("k2-r4-1: joined pastes with no ingredient list fail shellfish/fish/nuts/sesame/soy/dairy/gluten/egg/vegan/pescatarian", () => {
  for (const title of JOINED_PASTES) {
    const product = P(title, "100 g", 2.99);
    assert.equal(isMadeProductTitle(title), true, `${title} is a made product`);
    for (const { label, profile } of PROFILES) {
      assert.ok(hits(product, profile).length > 0, `${title} must refuse ${label} with no ingredient list (got pass)`);
    }
  }
});

test("k2-r4-1: spaced Shrimp Paste and Anchovy Paste with no ingredients fail all 8 tags plus vegan and pescatarian", () => {
  for (const title of ["Shrimp Paste", "Anchovy Paste"]) {
    const product = P(title, "100 g", 2.99);
    assert.equal(isMadeProductTitle(title), true, title);
    for (const { label, profile } of PROFILES) {
      assert.ok(hits(product, profile).length > 0, `${title} must refuse ${label} with no ingredient list`);
    }
  }
});

test("k2-r4-2: tomato/garlic/pumpkin paste and puree with no ingredients fail vegan and all 8 tags", () => {
  const titles = [
    "Tomato Paste",
    "Tomato Paste",
    "Tomatopaste",
    "Garlic Paste",
    "Garlicpaste",
    "Pumpkin Paste",
    "Pumpkinpaste",
    "Tomato Puree",
    "Tomato Purée",
    "Tomatopuree",
    "Garlic Puree",
    "Garlicpuree",
    "Pumpkin Puree",
    "Pumpkin Purée",
    "Pumpkinpuree",
  ];
  for (const title of titles) {
    const product = P(title, "156 ml", 1.29);
    assert.equal(isMadeProductTitle(title), true, title);
    assert.ok(hits(product, { prefs: ["vegan"] }).length > 0, `${title} must refuse vegan`);
    for (const id of EIGHT) {
      assert.ok(hits(product, { allergies: [id] }).length > 0, `${title} must refuse ${id}`);
    }
  }
});

test("k2-r4-2: whole fresh produce/meat/seafood with no ingredient list keep prior exemptions", () => {
  // Whole "Shrimp" / "Raw Shrimp" still PASS pescatarian (pescatarians eat seafood).
  assert.equal(hits(P("Raw Shrimp", "400 g", 9.99), { prefs: ["pescatarian"] }).length, 0);
  assert.equal(hits(P("Shrimp", "400 g", 9.99), { prefs: ["pescatarian"] }).length, 0);
  // Joined / spaced paste is stricter: pescatarian refuses when there is no label.
  assert.ok(hits(P("Shrimppaste", "100 g", 2.99), { prefs: ["pescatarian"] }).length > 0);
  assert.ok(hits(P("Shrimp Paste", "100 g", 2.99), { prefs: ["pescatarian"] }).length > 0);

  const garlic = P("Whole Garlic", "3 ea", 1.49);
  const onions = P("Yellow Onions", "3 lb", 3.79);
  const apples = P("Honeycrisp Apples", "1.36 kg", 5.99);
  const salmon = P("Atlantic Salmon Fillet", "454 g", 12.99);
  const chicken = P("Boneless Skinless Chicken Thighs", "620 g", 10.49);
  // "Mixed Greens" is pantry (not produce), so an empty label already failed
  // shields before r4. Confirm we did not newly treat "mixed" as a made-product "mix".
  assert.equal(isMadeProductTitle("Mixed Greens"), false);
  for (const p of [garlic, onions, apples]) {
    assert.equal(isMadeProductTitle(p.name), false, p.name);
    for (const id of EIGHT) {
      assert.equal(hits(p, { allergies: [id] }).length, 0, `${p.name} must still pass ${id}`);
    }
    assert.equal(hits(p, { prefs: ["vegan"] }).length, 0, `${p.name} must still pass vegan`);
    assert.equal(hits(p, { prefs: ["pescatarian"] }).length, 0, `${p.name} must still pass pescatarian`);
  }
  assert.equal(isMadeProductTitle(salmon.name), false);
  assert.equal(hits(salmon, { allergies: ["nuts"] }).length, 0);
  assert.equal(hits(salmon, { allergies: ["gluten"] }).length, 0);
  assert.equal(hits(salmon, { allergies: ["dairy"] }).length, 0);
  assert.equal(hits(salmon, { allergies: ["egg"] }).length, 0);
  assert.equal(hits(salmon, { allergies: ["soy"] }).length, 0);
  assert.equal(hits(salmon, { allergies: ["sesame"] }).length, 0);
  assert.ok(hits(salmon, { allergies: ["fish"] }).length > 0);
  assert.equal(hits(salmon, { prefs: ["pescatarian"] }).length, 0);
  assert.ok(hits(salmon, { prefs: ["vegan"] }).length > 0);

  assert.equal(isMadeProductTitle(chicken.name), false);
  assert.equal(hits(chicken, { allergies: ["gluten", "dairy", "nuts"] }).length, 0);
  assert.ok(hits(chicken, { prefs: ["vegan"] }).length > 0);
  assert.ok(hits(chicken, { prefs: ["pescatarian"] }).length > 0);
  assert.ok(hits(chicken, { allergies: ["shellfish"] }).length === 0);
});

test("k2-r4-2: a paste with a clean ingredient list still evaluates normally", () => {
  const tomato = P("Tomato Paste", "156 ml", 1.29, { ingredients: "Tomatoes, salt." });
  for (const id of ["nuts", "gluten", "dairy", "egg", "soy", "sesame", "fish", "shellfish"] as const) {
    assert.equal(hits(tomato, { allergies: [id] }).length, 0, `clean tomato paste must pass ${id}`);
  }
  assert.equal(hits(tomato, { prefs: ["vegan"] }).length, 0);
  assert.equal(hits(tomato, { prefs: ["pescatarian"] }).length, 0);

  const shrimp = P("Shrimp Paste", "100 g", 2.99, { ingredients: "Shrimp, salt." });
  assert.ok(hits(shrimp, { allergies: ["shellfish"] }).length > 0);
  assert.equal(hits(shrimp, { allergies: ["nuts"] }).length, 0);
  assert.equal(hits(shrimp, { allergies: ["gluten"] }).length, 0);
  assert.equal(hits(shrimp, { allergies: ["dairy"] }).length, 0);
  assert.equal(hits(shrimp, { prefs: ["pescatarian"] }).length, 0, "clean shrimp paste still passes pescatarian");
  assert.ok(hits(shrimp, { prefs: ["vegan"] }).length > 0);

  const anchovy = P("Anchovy Paste", "60 g", 2.49, { ingredients: "Anchovies, salt." });
  assert.ok(hits(anchovy, { allergies: ["fish"] }).length > 0);
  assert.equal(hits(anchovy, { allergies: ["nuts"] }).length, 0);
  assert.ok(hits(anchovy, { prefs: ["vegan"] }).length > 0);
  const salmonPaste = P("Salmonpaste", "100 g", 2.99, { ingredients: "Salmon, salt." });
  assert.ok(hits(salmonPaste, { allergies: ["fish"] }).length > 0);
  assert.equal(hits(salmonPaste, { allergies: ["nuts"] }).length, 0);
  assert.equal(hits(salmonPaste, { prefs: ["pescatarian"] }).length, 0, "clean salmon paste still passes pescatarian");

  const joined = P("Shrimppaste", "100 g", 2.99, { ingredients: "Shrimp, salt." });
  assert.ok(hits(joined, { allergies: ["shellfish"] }).length > 0);
  assert.equal(hits(joined, { allergies: ["nuts"] }).length, 0);
  assert.equal(hits(joined, { prefs: ["pescatarian"] }).length, 0);
});

test("k2-r4-1: lookalikes are not new over-blocks (eggplant, mixed greens, coconut milk, crabapple, oyster mushroom, buckwheat)", () => {
  assert.equal(isMadeProductTitle("Mixed Greens"), false);
  assert.equal(hits(P("Italian Eggplant", "1 ea", 2.49), { allergies: ["egg"] }).length, 0);
  assert.equal(hits(P("Coconut Milk", "400 ml", 2.49, { ingredients: "Coconut, water, guar gum." }), { allergies: ["dairy"] }).length, 0);
  assert.equal(hits(P("Coconut Milk", "400 ml", 2.49, { ingredients: "Coconut, water, guar gum." }), { prefs: ["vegan"] }).length, 0);
  assert.equal(hits(P("Crabapple Jelly", "250 ml", 3.49, { ingredients: "Crabapples, sugar, pectin." }), { allergies: ["shellfish"] }).length, 0);
  assert.equal(hits(P("Oyster Mushroom", "200 g", 3.99), { allergies: ["shellfish"] }).length, 0);
  assert.equal(hits(P("Buckwheat Groats", "500 g", 4.49, { ingredients: "Buckwheat." }), { allergies: ["gluten"] }).length, 0);
  assert.equal(hits(P("Vegetable Broth", "900 ml", 1.99, { ingredients: "Water, carrot, onion, celery, salt." }), { prefs: ["vegetarian"] }).length, 0);
});

test("k2-r4-3: pickExact still covers form/size; only safety decides the refuse", () => {
  const paste = P("Shrimppaste", "100 g", 2.99);
  const ok = pickExact({ line: L("shrimp paste", 1, "jar"), products: [paste] });
  assert.equal(ok.status, "pick", "without a profile the joined paste still matches the line");
  const blocked = pickExact({
    line: L("shrimp paste", 1, "jar"),
    products: [paste],
    profile: { allergies: ["shellfish"] },
  });
  assert.notEqual(blocked.status, "pick");
  assert.equal(blocked.pick ?? null, null);
  assert.equal(blocked.ranked.length, 0);
  assert.equal((blocked.choices ?? []).length, 0);
  assert.ok(
    blocked.reason === UNCHECKED_LABEL_REASON || /allergy|diet|settings|couldn't check/i.test(blocked.reason),
    `unexpected refuse reason: ${blocked.reason}`,
  );
});

test("k2-r4-3: live-search mock — shellfish profile + 'shrimp paste, 1 jar' with details failing to load refuses", async () => {
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
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes("/products/search")) {
      return new Response(JSON.stringify({ layout: { sections: { mainContentCollection: { components: [{ data: { productTiles: [shrimpTile] } }] } } } }), { status: 200 });
    }
    // Details failed to load.
    return new Response("no", { status: 404 });
  }) as typeof fetch;
  try {
    const r = await liveStoreResult({
      store,
      line: { name: "shrimp paste", qty: 1, unit: "jar", aisle: "Pantry" },
      storeId: "0357",
      profile: { allergies: ["shellfish"] },
    });
    assert.notEqual(r.status, "pick", `must refuse, got status=${r.status} option=${r.options[0]?.name ?? "none"} reason=${r.reason}`);
    assert.equal(r.options.length, 0);
    assert.equal((r.choices ?? []).length, 0);
    assert.ok(
      r.reason === UNCHECKED_LABEL_REASON || /allergy|diet|settings|couldn't check/i.test(r.reason ?? ""),
      `unexpected live refuse reason: ${r.reason}`,
    );
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.SPOONFUL_PCX_API_KEY;
    else process.env.SPOONFUL_PCX_API_KEY = realKey;
  }
});
