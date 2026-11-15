// k2 (Kitchen rulings, Nov 15): (a) N-for-$X only at need >= N, shown as the deal; (b) place search busy vs
// empty; (c) Fill with 0 adds says "Nothing added yet."; (d) tin/tins parse as units; (e) named forms
// (diced, whole, …); (f) "N oz can" is a can size.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { nothingAddedText } from "./grocery-cart.ts";
import { coverNeed, lineSaysCanned, pickExact, pickReason, productForms, type MatchProduct } from "./grocery-match.ts";
import { normalizeNeedLine, optionFromRank, shelfProduct, type CartNeed } from "./grocery-pick.ts";
import { makePlaceSearch, PLACE_BUSY_TEXT, PLACE_EMPTY_TEXT, PLACE_MAX_QUEUED, placeAnswerText } from "./places-core.ts";

const src = (rel: string) => readFile(new URL(rel, import.meta.url), "utf8");
const store = { brand: "superstore" as const, name: "Atlantic Superstore" };
const avocado = (deal?: string) =>
  shelfProduct("superstore", { title: "Hass Avocado", packageSizing: "1 ea", pricing: { price: "1.69" }, ...(deal ? { deal: { text: deal } } : {}) })! as MatchProduct;
const L = (name: string, qty: number, unit: string, aisle = "Produce") => ({ name, qty, unit, aisle }) as CartNeed;
const norm = (name: string) => normalizeNeedLine({ name, qty: 1, unit: "", aisle: "Pantry" } as CartNeed);

// --- (a) multi-buy -----------------------------------------------------------------------------------
test("k2-a: need 1 with '2 for $3.00' pays the regular price (no extra bought, no deal shown)", () => {
  const c = coverNeed(avocado("2 for $3.00"), L("avocado", 1, ""))!;
  assert.equal(c.totalCad, 1.69);
  assert.equal(c.packs, 1);
  assert.equal(c.deal, undefined);
});

test("k2-a: need 5 with '5 for $3.99' pays the deal and shows it as the deal text", () => {
  const p = avocado("5 for $3.99");
  const c = coverNeed(p, L("avocado", 5, ""))!;
  assert.deepEqual([c.totalCad, c.packs, c.deal], [3.99, 5, "5 for $3.99"]);
  const opt = optionFromRank(store, L("avocado", 5, ""), { product: p, cover: c }, 0, true);
  assert.equal(opt.dealLabel, "5 for $3.99");
  assert.equal(opt.unitPrice, undefined, "no bare per-item price next to a deal");
  assert.match(opt.why, /5 for \$3\.99/);
  const r = pickExact({ line: L("avocado", 5, ""), products: [p], profile: {} });
  assert.match(r.reason, /5 for \$3\.99 · \$3\.99 total/);
});

test("k2-a: need 6 with '5 for $3.99' = one deal group + 1 at the regular price (documented choice)", () => {
  const c = coverNeed(avocado("5 for $3.99"), L("avocado", 6, ""))!;
  assert.deepEqual([c.totalCad, c.packs, c.leftover, c.deal], [5.68, 6, 0, "5 for $3.99 + 1 × $1.69"]);
  // Need 4 (< N): regular price, 4 packs; need 10: two groups.
  assert.deepEqual([coverNeed(avocado("5 for $3.99"), L("avocado", 4, ""))!.totalCad, coverNeed(avocado("5 for $3.99"), L("avocado", 4, ""))!.deal], [6.76, undefined]);
  assert.equal(coverNeed(avocado("5 for $3.99"), L("avocado", 10, ""))!.totalCad, 7.98);
});

test("k2-a: a deal only re-ranks equally confirmed matches; below N it doesn't move the pick", () => {
  const loose = avocado("2 for $3.00");
  const other = shelfProduct("superstore", { title: "Hass Avocado Organic", packageSizing: "1 ea", pricing: { price: "1.59" } })! as MatchProduct;
  // Need 1: 1.59 beats the regular 1.69; the 2-for doesn't apply.
  assert.equal(pickExact({ line: L("avocado", 1, ""), products: [loose, other], profile: {} }).pick?.product.name, other.name);
  const reason = pickReason({ product: loose, cover: coverNeed(loose, L("avocado", 2, ""))!, unit: null } as never, L("avocado", 2, ""), 1);
  assert.match(reason, /2 for \$3\.00/);
});

test("k2-a: the sheet shows the deal label on options, choices and the pick row", async () => {
  const s = await src("../components/grocery-near.tsx");
  assert.match(s, /option\.dealLabel \? ` · \$\{option\.dealLabel\}`/);
  assert.match(s, /choice\.dealLabel \? ` · \$\{choice\.dealLabel\}`/);
  assert.match(s, /pick\.dealLabel \? ` · \$\{pick\.dealLabel\}`/);
});

// --- (b) place search busy vs empty ----------------------------------------------------------------
function placeRig(rows: unknown[] = [{ display_name: "Point Pleasant Park, Halifax", lat: "44.62", lon: "-63.57" }]) {
  const calls: string[] = [];
  let t = 0;
  const lookup = makePlaceSearch({
    fetchImpl: (async (url: URL) => {
      calls.push(String(url));
      return Response.json(rows);
    }) as unknown as typeof fetch,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    baseUrl: "https://example.test/search",
  });
  return { lookup, calls };
}

test("k2-b: a full queue answers busy (no upstream call); an empty answer is not busy", async () => {
  const { lookup, calls } = placeRig();
  const answers = await Promise.all(Array.from({ length: PLACE_MAX_QUEUED + 2 }, (_, i) => lookup.lookup(`park ${i}`)));
  assert.equal(calls.length, PLACE_MAX_QUEUED);
  assert.deepEqual(answers.map((a) => a.busy), [false, false, false, true, true]);
  assert.equal(placeAnswerText(answers.at(-1)!), PLACE_BUSY_TEXT);
  assert.equal(PLACE_BUSY_TEXT, "Place search is busy, try again in a moment.");
  assert.equal(placeAnswerText(answers[0]!), null);
  const empty = placeRig([]);
  const none = await empty.lookup.lookup("nowhere at all");
  assert.deepEqual(none, { hits: [], busy: false });
  assert.equal(placeAnswerText(none), PLACE_EMPTY_TEXT);
  // Cache unchanged: a repeat hit is served without a new call; the plain search() still returns hits.
  const again = await lookup("park 0");
  assert.equal(again.length, 1);
  assert.equal(calls.length, PLACE_MAX_QUEUED);
});

test("k2-b: the server fn returns { hits, busy } and the map words it", async () => {
  assert.match(await src("./places.ts"), /Promise<PlaceAnswer> => placeSearch\.lookup\(data\.q\)/);
  const map = await src("../components/route-map.tsx");
  assert.match(map, /toastPlaceAnswer\(answer, toast\)/);
  assert.doesNotMatch(map, /No place matched that/);
});

// --- (c) Fill with 0 adds ----------------------------------------------------------------------------
test("k2-c: 0 adds says 'Nothing added yet.' with the reason, never Cart is filling / Cart ready", async () => {
  assert.equal(nothingAddedText({ unsure: ["saffron"] }), "Nothing added yet. 1 item needs your pick (no exact match): saffron.");
  assert.equal(nothingAddedText({ alreadyInBag: true }), "Nothing added yet. Everything on this list is already in your bag.");
  assert.equal(nothingAddedText({ noPicks: true }), "Nothing added yet. Pick a match for each item first.");
  assert.equal(nothingAddedText(), "Nothing added yet.");
  for (const t of [nothingAddedText({ unsure: ["a", "b", "c", "d"] }), nothingAddedText({ noPicks: true })]) assert.doesNotMatch(t, /Cart is filling|Cart ready|filling/i);
  const s = await src("../components/grocery-near.tsx");
  const add = s.slice(s.indexOf("async function addAll"), s.indexOf("async function fillAndNotify"));
  assert.match(add, /if \(chosenItems\.length === 0\) \{\s*toast\(nothingAddedText\(\{ unsure: unsure\.map\(\(item\) => item\.name\) \}\)\);\s*return false;/);
  assert.match(add, /if \(leftover\.length === 0\) \{\s*toast\(nothingAddedText\(\{ alreadyInBag: true \}\)\);\s*return false;/);
  const fill = s.slice(s.indexOf("async function fillAndNotify"), s.indexOf("function launchTill"));
  // The "Filling your cart" ping on the helios path only fires from addAll's first-pick callback.
  const helios = fill.slice(0, fill.indexOf("// k2: nothing picked means nothing to fill"));
  const ping = helios.indexOf('notifyNative("Filling your cart"');
  assert.ok(ping > helios.indexOf("const filled = await addAll(async () => {"));
  assert.ok(helios.indexOf('notifyNative("Cart ready to review"') > helios.indexOf("if (!filled || storeCartOff()) return;"));
  assert.match(fill, /if \(Object\.keys\(chosen\)\.length === 0\) \{\s*toast\(nothingAddedText\(\{ noPicks: true \}\)\);\s*return;/);
});

// --- (d) tin / tins ----------------------------------------------------------------------------------
test("k2-d: 'tin'/'tins' parse as units like 'can'/'cans'", () => {
  assert.deepEqual(norm("2 tins chopped tomatoes"), { name: "chopped tomatoes", qty: 2, unit: "tin", aisle: "Pantry" });
  assert.deepEqual(norm("1 tin coconut milk"), { name: "coconut milk", qty: 1, unit: "tin", aisle: "Pantry" });
  assert.deepEqual(norm("chopped tomatoes 2 tins"), { name: "chopped tomatoes", qty: 2, unit: "tin", aisle: "Pantry" });
  assert.deepEqual(norm("2 cans chopped tomatoes"), { name: "chopped tomatoes", qty: 2, unit: "cans", aisle: "Pantry" });
  const canned = { brand: "superstore", name: "No Name Canned Chopped Tomatoes", sizeLabel: "796 mL", ml: 796, priceCad: 1.49, ingredients: "Tomatoes, salt." } as unknown as MatchProduct;
  const line = norm("2 tins chopped tomatoes");
  assert.equal(pickExact({ line, products: [canned], profile: {} }).pick?.product.name, canned.name);
});

test("k2-d: word boundaries — Canada, candied, cane, pecan, scant, can opener are not can units", () => {
  for (const name of ["Canada grade A tomatoes", "candied tomatoes", "cane sugar", "pecan chickpeas", "scant cup chickpeas"]) {
    assert.equal(lineSaysCanned({ name, unit: "cup" }), false, name);
    assert.ok(!["tin", "tins", "can", "cans"].includes(norm(name).unit), name);
  }
  const can = { brand: "superstore", name: "No Name Canned Chickpeas", sizeLabel: "540 mL", ml: 540, priceCad: 1.29, ingredients: "Chickpeas, water, salt." } as unknown as MatchProduct;
  assert.equal(pickExact({ line: L("can opener", 1, "", "Pantry"), products: [can], profile: {} }).ranked.length, 0);
  const brandOnly = { ...can, name: "Canned Goods Co. Chickpeas" } as MatchProduct;
  assert.equal(pickExact({ line: L("chickpeas", 1, "cup", "Pantry"), products: [brandOnly], profile: {} }).ranked.length, 0);
});

// --- (e) named forms ---------------------------------------------------------------------------------
const tom = (name: string, priceCad: number) =>
  ({ brand: "superstore", name, sizeLabel: "796 mL", ml: 796, priceCad, ingredients: "Tomatoes, tomato juice, salt." }) as unknown as MatchProduct;

test("k2-e: 'diced tomatoes, 1 can' never picks Whole Canned Tomatoes when Diced exists, and rejects whole outright", () => {
  const whole = tom("No Name Whole Canned Tomatoes", 1.19);
  const diced = tom("No Name Diced Tomatoes", 1.49);
  for (const order of [[whole, diced], [diced, whole]]) {
    const r = pickExact({ line: L("diced tomatoes", 1, "can", "Pantry"), products: order, profile: {} });
    assert.equal(r.pick?.product.name, diced.name);
    assert.ok(!r.ranked.some((x) => x.product.name === whole.name));
  }
  const alone = pickExact({ line: L("diced tomatoes", 1, "can", "Pantry"), products: [whole], profile: {} });
  assert.equal(alone.pick, null);
  assert.equal(alone.ranked.length, 0);
  for (const [line, prod] of [["crushed tomatoes", "Canned Diced Tomatoes"], ["tomato paste", "Tomato Sauce"], ["tomato puree", "Crushed Tomatoes"], ["stewed tomatoes", "Whole Peeled Tomatoes"]]) {
    assert.equal(pickExact({ line: L(line, 1, "can", "Pantry"), products: [tom(prod, 1)], profile: {} }).ranked.length, 0, `${line} vs ${prod}`);
  }
  assert.deepEqual([...productForms("Tomato Purée")], ["puree"]);
});

test("k2-e: a title naming no form is allowed only when no matching form is on offer", () => {
  const plain = tom("No Name Canned Tomatoes", 1.09);
  const diced = tom("No Name Diced Tomatoes", 1.49);
  assert.equal(pickExact({ line: L("diced tomatoes", 1, "can", "Pantry"), products: [plain, diced], profile: {} }).pick?.product.name, diced.name);
  assert.equal(pickExact({ line: L("diced tomatoes", 1, "can", "Pantry"), products: [plain], profile: {} }).pick?.product.name, plain.name);
});

test("k2-e: a line naming no form takes any form (unchanged)", () => {
  const whole = tom("No Name Whole Canned Tomatoes", 1.19);
  const diced = tom("No Name Diced Canned Tomatoes", 1.49);
  assert.equal(pickExact({ line: L("tomatoes", 1, "can", "Pantry"), products: [whole, diced], profile: {} }).pick?.product.name, whole.name);
});

// --- (f) "N oz can" ----------------------------------------------------------------------------------
test("k2-f: '(19 oz) can chickpeas' with no unit picks the 540 mL No Name can instead of asking", () => {
  const nn = { brand: "superstore", name: "No Name Chickpeas", sizeLabel: "540 mL", ml: 540, priceCad: 1.29, ingredients: "Chickpeas, water, salt." } as unknown as MatchProduct;
  const big = { ...nn, name: "Unico Chickpeas", sizeLabel: "796 mL", ml: 796, priceCad: 1.19 } as MatchProduct;
  const r = pickExact({ line: L("(19 oz) can chickpeas", 1, "", "Pantry"), products: [big, nn], profile: {} });
  assert.equal(r.status, "pick");
  assert.equal(r.pick?.product.name, nn.name);
  assert.equal(r.pick?.cover.packs, 1);
  // "2 (19 oz) cans" -> 2 of them; 19 × 28.4 = 539.6 ml, ±10%.
  assert.equal(pickExact({ line: L("chickpeas (19 oz)", 2, "cans", "Pantry"), products: [nn], profile: {} }).pick?.cover.packs, 2);
});
