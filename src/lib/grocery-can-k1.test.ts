// k1 (Kitchen ruling, Nov 15): a line that says the item comes canned/tinned accepts "Canned"/"Tinned" titles;
// fresh/dried lines without can/tin wording still reject canned exactly as before.
import assert from "node:assert/strict";
import { test } from "node:test";
import { compare, lineSaysCanned, pickExact, type MatchProduct } from "./grocery-match.ts";

const mk = (name: string, priceCad: number, ml = 540, ingredients = "Chickpeas, water, salt."): MatchProduct =>
  ({ brand: "superstore", name, sizeLabel: `${ml} mL`, ml, priceCad, ingredients }) as unknown as MatchProduct;
const line = (name: string, qty: number, unit: string) => ({ name, qty, unit, aisle: "Pantry" });
const pick = (l: ReturnType<typeof line>, products: MatchProduct[]) => pickExact({ line: l, products, profile: {} });

test("k1: '1 can chickpeas' accepts 'PC No Name Canned Chickpeas' and picks the cheaper can", () => {
  const a = mk("PC No Name Canned Chickpeas", 1.29);
  const b = mk("Unico Chickpeas", 1.79);
  for (const order of [[a, b], [b, a]]) {
    const r = pick(line("chickpeas", 1, "can"), order);
    assert.equal(r.pick?.product.name, a.name);
    assert.ok(r.ranked.some((x) => x.product.name === b.name), "the uncanned-title can stays a confirmed match too");
  }
});

test("k1: '1 (19 oz) can chickpeas' (can wording in the name) accepts the Canned title", () => {
  assert.equal(compare("(19 oz) can chickpeas", mk("PC No Name Canned Chickpeas", 1.29)).ok, true);
  assert.equal(lineSaysCanned({ name: "(19 oz) can chickpeas", unit: "" }), true);
  // The form check passes; "(19 oz)" sizing (read as weight vs a 540 mL can) is a separate cover rule, unchanged here.
  const r = pick(line("(540 mL) can chickpeas", 1, ""), [mk("PC No Name Canned Chickpeas", 1.29), mk("Unico Chickpeas", 1.79)]);
  assert.equal(r.pick?.product.name, "PC No Name Canned Chickpeas");
});

test("k1: fresh or dried chickpea lines (no can/tin wording) still reject canned", () => {
  const canned = mk("PC No Name Canned Chickpeas", 1.29);
  for (const [name, unit] of [["chickpeas", "cup"], ["chickpeas", "g"], ["fresh chickpeas", "cup"], ["dried chickpeas", "cup"]] as const) {
    assert.equal(lineSaysCanned({ name, unit }), false);
    const v = compare(name, canned, "Pantry", { canOk: lineSaysCanned({ name, unit }) });
    assert.equal(v.ok, false, `${name} / ${unit} must still reject canned`);
    const r = pick(line(name, 1, unit), [canned]);
    assert.ok(!r.ranked.some((x) => x.product.name === canned.name), `${name} / ${unit}: canned is not a confirmed match`);
  }
  assert.ok(compare("chickpeas", canned).differs.includes("canned, recipe means fresh"));
});

test("k1: an explicit 'fresh' line keeps rejecting canned even with a can unit", () => {
  assert.equal(compare("fresh tomatoes", mk("Canned Whole Tomatoes", 1.49, 796, "Tomatoes, salt."), "Pantry", { canOk: true }).ok, false);
});

test("k1: tomatoes, beans and coconut milk with a can unit accept canned/tinned titles", () => {
  const cases: [string, MatchProduct][] = [
    ["diced tomatoes", mk("No Name Canned Diced Tomatoes", 1.49, 796, "Tomatoes, tomato juice, salt, calcium chloride, citric acid.")],
    ["black beans", mk("Canned Black Beans", 1.39, 540, "Black beans, water, salt.")],
    ["kidney beans", mk("Tinned Red Kidney Beans", 1.39, 540, "Red kidney beans, water, salt.")],
    ["coconut milk", mk("Thai Kitchen Canned Coconut Milk", 2.49, 400, "Coconut, water, guar gum.")],
  ];
  for (const [name, product] of cases) {
    for (const unit of ["can", "cans", "tin"]) {
      assert.equal(lineSaysCanned({ name, unit }), true);
      const r = pick(line(name, 1, unit), [product]);
      assert.equal(r.pick?.product.name, product.name, `${name} / ${unit}`);
    }
    // Same food without can/tin wording: unchanged (rejects canned).
    assert.ok(compare(name, product).differs.includes("canned, recipe means fresh"), `${name} without can wording`);
  }
});

test("k1: other refusals are untouched by can wording (allergy shield still blocks)", () => {
  const p = mk("Compliments Canned Chickpeas", 1.29, 540, "Chickpeas, water, salt, sesame.");
  const r = pickExact({ line: line("chickpeas", 1, "can"), products: [p], profile: { allergies: ["sesame"] } as never });
  assert.equal(r.pick ?? null, null);
  // Control: without the allergy the same canned product is picked, so the refusal above is the shield's.
  assert.equal(pickExact({ line: line("chickpeas", 1, "can"), products: [p], profile: {} }).pick?.product.name, p.name);
});
