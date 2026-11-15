import assert from "node:assert/strict";
import test from "node:test";
import { pickExact, type MatchProduct } from "./grocery-match.ts";
import { packCountFromName, payablePackPrice, shelfProduct, type ShelfDeal, type ShelfPricing } from "./grocery-pick.ts";

// m1 r3 regression set for Line's m1 r2 audit (finding 1). Tiles are copied from captured PC Express
// searches (gp-work raw-chicken-thighs p1/p2): pricing and deal fields verbatim, other fields trimmed.
type CapturedTile = { brand: string | null; title: string; packageSizing: string; pricing: ShelfPricing; deal: ShelfDeal };
const pr = (price: string, wasPrice: string | null = null, displayPrice = `$${price}`): ShelfPricing => ({
  price,
  wasPrice,
  displayPrice,
  memberOnlyPrice: null,
  mopDisplayPrice: null,
});
const MIN2_6 = { type: "MULTI", text: "$6.00 MIN 2", name: "MULTI" };
const CAPTURED: CapturedTile[] = [
  { brand: "Crave", title: "Spicy Szechuan Style Fried Chicken on Rice", packageSizing: "300 g, $2.33/100g", pricing: pr("6.99"), deal: MIN2_6 },
  { brand: "Crave", title: "Smokehouse Style Meat & Potatoes", packageSizing: "278 g, $2.51/100g", pricing: pr("6.99"), deal: MIN2_6 },
  { brand: "Crave", title: "Pulled Chicken Burrito Bowl Frozen Meal", packageSizing: "320 g, $2.18/100g", pricing: pr("6.99"), deal: MIN2_6 },
  { brand: "Crave", title: "Buffalo Chicken Mac & Cheese Frozen Meal", packageSizing: "300 g, $2.33/100g", pricing: pr("6.99"), deal: MIN2_6 },
  { brand: "Club House", title: "Chicken Gravy Mix", packageSizing: "25 g, $9.96/100g", pricing: pr("2.49"), deal: { type: "MULTI", text: "$2.00 MIN 2", name: "MULTI" } },
  { brand: "Wong Wing", title: "General Tao Chicken", packageSizing: "400 g, $1.88/100g", pricing: pr("7.50", "$8.00"), deal: { type: "SALE", text: "SAVE $0.50", name: "SALE" } },
  { brand: null, title: "Chicken Thigh Boneless Skinless Club Pack", packageSizing: "$15.41/1kg $6.99/1lb", pricing: pr("15.46", "$16.34", "about $15.46"), deal: { type: "SALE", text: "SAVE $0.88", name: "SALE" } },
  { brand: "Watson Ridge", title: "Chicken Breasts", packageSizing: "800 g, $1.88/100g", pricing: pr("15.00", "$16.00"), deal: { type: "SALE", text: "SAVE $1.00", name: "SALE" } },
  { brand: "Prime", title: "Raised Without Antibiotics Chicken Meatballs", packageSizing: "700 g, $1.71/100g", pricing: pr("12.00", "$14.00"), deal: { type: "SALE", text: "SAVE $2.00", name: "SALE" } },
  { brand: null, title: "30 Wing Bucket with Potato Wedges", packageSizing: "2050 g, $0.98/100g", pricing: pr("20.00", "$30.00"), deal: { type: "SALE", text: "SAVE $10.00", name: "SALE" } },
];

test("r3: every captured tile is priced at the store's current price, never a MIN/SAVE figure", () => {
  for (const t of CAPTURED) {
    const p = shelfProduct("superstore", { brand: t.brand ?? undefined, title: t.title, packageSizing: t.packageSizing, pricing: t.pricing, deal: t.deal });
    assert.equal(p?.priceCad, Number(t.pricing.price), t.title);
    assert.equal(p?.dealCount, undefined, `${t.title}: '${t.deal?.text}' is not a multi-buy`);
  }
});

const gravy = (t: CapturedTile) => shelfProduct("superstore", { brand: t.brand ?? undefined, title: t.title, packageSizing: t.packageSizing, pricing: t.pricing, deal: t.deal })!;
const clubHouse = gravy(CAPTURED[4]!);
const noName = gravy({ brand: "No Name", title: "Chicken Gravy Mix", packageSizing: "25 g", pricing: pr("2.29"), deal: null });

test("R1 '$2.00 MIN 2' does not price one pack at $2.00", () => {
  assert.equal(clubHouse.priceCad, 2.49);
});

test("R2 one gravy mix: No Name $2.29, not Club House 'at $2.00'", () => {
  const r = pickExact({ line: { name: "chicken gravy mix", qty: 1, unit: "pkg", aisle: "Pantry" }, products: [clubHouse, noName] as MatchProduct[], profile: {} });
  assert.equal(r.pick?.product.name, "No Name Chicken Gravy Mix");
  assert.equal(r.pick?.cover.totalCad, 2.29);
});

test("P1–P3: OFF, 'off N' and member prices are conditions, never the pack price", () => {
  assert.equal(payablePackPrice({ price: "7.99" }, { text: "$1.00 OFF" }).priceCad, 7.99);
  assert.equal(payablePackPrice({ price: "5.49" }, { text: "$2 off 2" }).priceCad, 5.49);
  assert.equal(payablePackPrice({ price: "6.99", memberOnlyPrice: "4.99" }).priceCad, 6.99);
  assert.equal(payablePackPrice({ price: "6.99", mopDisplayPrice: "$4.99" }).priceCad, 6.99);
  assert.equal(payablePackPrice({ price: "3.99", wasPrice: "5.99" }).priceCad, 3.99);
  // A member or PC Optimum multi-buy is ignored; there is no membership flag.
  assert.equal(payablePackPrice({ price: "1.69" }, { type: "PCO", text: "5 for $3.99", name: "PC Optimum" }).dealCount, undefined);
});

test("multi-buy: only a plain 'N for $X' that is cheaper per unit", () => {
  assert.deepEqual(payablePackPrice({ price: "1.69" }, { text: "5 for $3.99" }), { priceCad: 1.69, dealCount: 5, dealCad: 3.99 });
  assert.deepEqual(payablePackPrice({ price: "4.00" }, { text: "3/$10" }), { priceCad: 4, dealCount: 3, dealCad: 10 });
  for (const text of ["$2.00 MIN 2", "2 for $5 MIN 2", "Buy 2 for $5 with PC Optimum", "2 for $9", "SAVE $1 when you buy 2"]) {
    assert.equal(payablePackPrice({ price: "4.49" }, { text }).dealCount, undefined, text);
  }
});

test("W1 (pricing only): a '$1.00 OFF' badge never flips the pick to the dearer can", () => {
  const can = (title: string, price: string, deal: ShelfDeal = null) => ({
    ...shelfProduct("superstore", { brand: "PC", title, packageSizing: "540 mL", pricing: { price }, deal })!,
    ingredients: "Chickpeas, water, salt.",
  });
  const a = can("No Name Chickpeas", "1.29");
  const b = can("Unico Chickpeas", "1.79", { text: "$1.00 OFF" });
  const r = pickExact({ line: { name: "chickpeas", qty: 1, unit: "can", aisle: "Pantry" }, products: [a, b] as MatchProduct[], profile: {} });
  assert.equal(r.pick?.product.name, "PC No Name Chickpeas");
});

test("pricing only re-ranks confirmed matches: deals never change status, the confirmed set or choices", () => {
  const make = ([title, size, price]: string[], text?: string) =>
    shelfProduct("superstore", { brand: "PC", title: title!, packageSizing: size!, pricing: { price: price! }, deal: text ? { text } : null })!;
  const lines = [
    { name: "avocado", qty: 4, unit: "", aisle: "Produce" },
    { name: "chicken gravy mix", qty: 2, unit: "pkg", aisle: "Pantry" },
    { name: "lemon", qty: 3, unit: "", aisle: "Produce" },
  ];
  const sets = [
    [["Hass Avocado", "1 ea", "1.69"], ["Hass Avocados 3 Pack", "3 pk", "5.99"]],
    [["Club House Chicken Gravy Mix", "25 g", "2.49"], ["No Name Chicken Gravy Mix", "25 g", "2.29"]],
    [["Lemon", "", "0.99"], ["Lemons Bag", "", "3.99"]],
  ];
  const deals = ["5 for $3.99", "$2.00 MIN 2", "$1.00 OFF", "3/$2"];
  lines.forEach((line, i) => {
    const before = pickExact({ line, products: sets[i]!.map((row) => make(row)) as MatchProduct[], profile: {} });
    for (const d of deals) {
      const products = sets[i]!.map((row) => make(row, d));
      const after = pickExact({ line, products: products as MatchProduct[], profile: {} });
      assert.equal(after.status, before.status, `${line.name} ${d}`);
      assert.deepEqual(after.ranked.map((r) => r.product.name).sort(), before.ranked.map((r) => r.product.name).sort(), `${line.name} ${d}`);
      assert.deepEqual(after.choices.map((c) => c.product.name).sort(), before.choices.map((c) => c.product.name).sort(), `${line.name} ${d}`);
    }
  });
});

test("H1 '8-10 count' is the low end (8), never 10", () => {
  assert.equal(packCountFromName("Chicken Thighs Value Pack 8-10 count"), 8);
  assert.equal(packCountFromName("Drumsticks 8 to 10 ct"), 8);
  assert.equal(shelfProduct("superstore", { brand: "PC", title: "Chicken Thighs Value Pack 8-10 count", packageSizing: "1 ea", pricing: { price: "12.99" } })?.each, 8);
  assert.equal(packCountFromName("Hass Avocados 3 Pack"), 3);
});
