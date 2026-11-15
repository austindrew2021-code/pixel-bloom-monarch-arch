// k2 r2 (Kitchen rulings, Nov 15): (1) form rule only on canned/jarred lines or when the form is the
// product, plus space-insensitive "apple sauce"/"applesauce"; (2) N oz can: standard Canadian sizes,
// else 0 to +10% over, never short; (3) Filling ping after the first successful store add, failed add
// wording; (4) no-unit can line names the item when asking size; (5) place-search upstream failure
// wording; (6) multi-buy unchanged.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { nothingAddedText, storeAddFailedText } from "./grocery-cart.ts";
import {
  canMatchesOz,
  coverNeed,
  formRuleApplies,
  pickExact,
  productForms,
  type MatchProduct,
} from "./grocery-match.ts";
import { normalizeNeedLine, type CartNeed } from "./grocery-pick.ts";
import {
  makePlaceSearch,
  PLACE_BUSY_TEXT,
  PLACE_DOWN_TEXT,
  PLACE_EMPTY_TEXT,
  placeAnswerText,
} from "./places-core.ts";

const src = (rel: string) => readFile(new URL(rel, import.meta.url), "utf8");
const L = (name: string, qty: number, unit: string, aisle = "Produce") => ({ name, qty, unit, aisle }) as CartNeed;
const P = (name: string, sizeLabel: string, priceCad: number, extra: Partial<MatchProduct> = {}) =>
  ({ brand: "superstore", name, sizeLabel, priceCad, ...extra }) as unknown as MatchProduct;

// --- (1) named-form rule -----------------------------------------------------------------------------
test("k2-r2-1: fresh crushed garlic, diced onion and diced tomatoes pick Whole-titled produce (as on 814f702)", () => {
  const garlic = P("Garlic, Whole Bulb", "1 ea", 0.79, { each: 1 });
  const onion = P("Whole Yellow Onions", "3 lb", 2.99, { grams: 1361, each: 1 });
  const tomato = P("Whole Roma Tomatoes", "1 ea", 0.69, { each: 1, grams: 120 });
  assert.equal(formRuleApplies(L("crushed garlic", 1, ""), "produce"), false);
  assert.equal(pickExact({ line: L("crushed garlic", 1, ""), products: [garlic], profile: {} }).pick?.product.name, garlic.name);
  const cupOnion = normalizeNeedLine({ name: "1 cup diced onion", qty: 1, unit: "", aisle: "Produce" } as CartNeed);
  for (const line of [L("diced onion", 1, "cup"), L("diced onion", 1, ""), cupOnion]) {
    const r = pickExact({ line, products: [onion], profile: {}, gramsPerCup: 150 });
    assert.equal(r.pick?.product.name, onion.name, `${line.name} [${line.unit}]`);
  }
  assert.equal(pickExact({ line: L("diced tomatoes", 1, ""), products: [tomato], profile: {} }).pick?.product.name, tomato.name);
});

test("k2-r2-1: canned diced tomatoes still refuse Whole when Diced exists; paste/sauce/puree still apply without a can unit", () => {
  const whole = P("No Name Whole Canned Tomatoes", "796 mL", 1.19, { ml: 796, ingredients: "Tomatoes, salt." });
  const diced = P("No Name Diced Tomatoes", "796 mL", 1.49, { ml: 796, ingredients: "Tomatoes, salt." });
  const r = pickExact({ line: L("diced tomatoes", 1, "can", "Pantry"), products: [whole, diced], profile: {} });
  assert.equal(r.pick?.product.name, diced.name);
  assert.equal(pickExact({ line: L("diced tomatoes", 1, "can", "Pantry"), products: [whole], profile: {} }).pick, null);
  assert.equal(formRuleApplies(L("tomato paste", 1, "", "Pantry")), true);
  assert.equal(pickExact({ line: L("tomato paste", 1, "", "Pantry"), products: [P("Tomato Sauce", "156 mL", 1.19, { ml: 156 })], profile: {} }).ranked.length, 0);
});

test("k2-r2-1: 'apple sauce' equals 'Applesauce' (space-insensitive); cheapest wins", () => {
  assert.deepEqual([...productForms("Applesauce")], ["sauce"]);
  assert.deepEqual([...productForms("Apple Sauce")], ["sauce"]);
  assert.deepEqual([...productForms("apple sauce")], ["sauce"]);
  const cheap = P("Applesauce", "796 mL", 2.29, { ml: 796, each: 1, ingredients: "Apples, water, sugar." });
  const dear = P("Apple Sauce", "796 mL", 2.49, { ml: 796, each: 1, ingredients: "Apples, water, sugar." });
  for (const name of ["apple sauce", "applesauce"]) {
    for (const unit of ["", "jar"]) {
      const r = pickExact({ line: L(name, 1, unit, "Pantry"), products: [dear, cheap], profile: {} });
      assert.equal(r.status, "pick", `${name} [${unit}]`);
      assert.equal(r.pick?.product.name, cheap.name, `${name} [${unit}]`);
      assert.equal(r.pick?.cover.totalCad, 2.29);
    }
  }
});

test("k2-r2-1: meat and seafood stay exempt (crushed crab still picks Whole)", () => {
  const crab = P("Snow Crab Meat Whole", "227 g", 8.99, { grams: 227, each: 1, ingredients: "Snow crab." });
  assert.equal(formRuleApplies(L("crushed crab", 1, ""), "seafood"), false);
  assert.equal(pickExact({ line: L("crushed crab", 1, "", "Seafood"), products: [crab], profile: {} }).pick?.product.name, crab.name);
});

// --- (2) N oz can ------------------------------------------------------------------------------------
test("k2-r2-2: Line's oz-can cases — 15 oz asks (398 short), 28 oz picks 796 not 750, 19 oz -> 540, 14 oz -> 398", () => {
  const ml = (n: number, priceCad: number) => P("No Name Diced Tomatoes", `${n} mL`, priceCad, { ml: n, ingredients: "Tomatoes, salt." });
  const fifteen = pickExact({ line: L("canned diced tomatoes (15 oz)", 1, "can", "Pantry"), products: [ml(398, 1.29)], profile: {} });
  assert.equal(fifteen.status, "ask");
  assert.equal(fifteen.pick, null);
  const cans28 = [ml(750, 1.49), ml(796, 1.79)];
  const r28 = pickExact({ line: L("canned diced tomatoes (28 oz)", 1, "can", "Pantry"), products: cans28, profile: {} });
  assert.equal(r28.status, "pick");
  assert.equal(r28.pick?.product.ml, 796);
  assert.equal(pickExact({ line: L("canned diced tomatoes (28 oz)", 1, "can", "Pantry"), products: [ml(750, 1.49)], profile: {} }).status, "ask");
  assert.equal(pickExact({ line: L("(19 oz) can chickpeas", 1, "", "Pantry"), products: [P("No Name Chickpeas", "540 mL", 1.29, { ml: 540, ingredients: "Chickpeas, water, salt." })], profile: {} }).pick?.product.ml, 540);
  assert.equal(pickExact({ line: L("chickpeas (14 oz)", 1, "can", "Pantry"), products: [P("No Name Chickpeas", "398 mL", 1.19, { ml: 398, ingredients: "Chickpeas, water, salt." })], profile: {} }).pick?.product.ml, 398);
});

test("k2-r2-2: standard Canadian table (±1 ml) then 0 to +10% over, never short", () => {
  assert.equal(canMatchesOz(156, 5.5), true);
  assert.equal(canMatchesOz(155, 5.5), true);
  assert.equal(canMatchesOz(157, 5.5), true);
  assert.equal(canMatchesOz(154, 5.5), false);
  assert.equal(canMatchesOz(284, 10), true);
  assert.equal(canMatchesOz(398, 14), true);
  assert.equal(canMatchesOz(540, 19), true);
  assert.equal(canMatchesOz(796, 28), true);
  assert.equal(canMatchesOz(750, 28), false);
  assert.equal(canMatchesOz(398, 15), false);
  // 13 oz is not in the table: 13 × 28.4 = 369.2, 398 is 7.8% over — allowed.
  assert.equal(canMatchesOz(398, 13), true);
  assert.equal(canMatchesOz(368, 13), false, "never short");
});

// --- (3) fill ping and failed store add --------------------------------------------------------------
test("k2-r2-3: failed store add wording; Filling ping is after the first successful store add", async () => {
  assert.equal(storeAddFailedText(), "Couldn't add that to the store cart");
  assert.equal(storeAddFailedText({ added: 0, wanted: 3 }), "Couldn't add that to the store cart");
  assert.equal(storeAddFailedText({ added: 2, wanted: 3 }), "Couldn't add that to the store cart. 2 of 3 packs made it in.");
  assert.doesNotMatch(storeAddFailedText({ added: 2, wanted: 3 }), /Cart ready|Cart is filling/i);
  assert.equal(nothingAddedText({ noPicks: true }).startsWith("Nothing added yet."), true);
  const s = await src("../components/grocery-near.tsx");
  const add = s.slice(s.indexOf("async function addAll"), s.indexOf("async function fillAndNotify"));
  const loopAt = add.indexOf("for (const item of leftover)");
  const pushAt = add.indexOf("const ok = await pushStore([item], merged);");
  const pingAt = add.indexOf("if (onFirstPick)");
  assert.ok(loopAt > 0 && pushAt > loopAt && pingAt > pushAt, "onFirstPick must run after a successful pushStore, not while matching");
  assert.doesNotMatch(add.slice(loopAt, add.indexOf("setChosen(")), /onFirstPick/);
  assert.match(add, /storeAddFailedText\(\{ added, wanted: packed\.length \}\)/);
  assert.match(add, /toast\(storeAddFailedText\(\{ added, wanted: packed\.length \}\) \+ askNote\);\s*return false;/);
  const fill = s.slice(s.indexOf("async function fillAndNotify"), s.indexOf("function launchTill"));
  assert.ok(fill.indexOf('notifyNative("Cart ready to review"') > fill.indexOf("if (!filled || storeCartOff()) return;"));
});

// --- (4) no-unit can line size question --------------------------------------------------------------
test("k2-r2-4: a no-unit can line with two shelf sizes names the item and never says '\"\" with no size'", () => {
  const small = P("No Name Canned Tomatoes", "398 mL", 1.29, { ml: 398, ingredients: "Tomatoes, salt." });
  const large = P("No Name Canned Tomatoes", "796 mL", 1.79, { ml: 796, ingredients: "Tomatoes, salt." });
  const r = pickExact({ line: L("tinned tomatoes", 2, "", "Pantry"), products: [small, large], profile: {} });
  assert.equal(r.status, "ask");
  assert.equal(r.pick, null);
  assert.match(r.reason, /tinned tomatoes/);
  assert.match(r.reason, /size/i);
  assert.doesNotMatch(r.reason, /"" with no size/);
  assert.doesNotMatch(r.reason, /says ""/);
});

// --- (5) place search upstream failure ---------------------------------------------------------------
test("k2-r2-5: map service 429, 5xx, timeout or network error is down, not busy and not 'No place matched'", async () => {
  assert.equal(PLACE_DOWN_TEXT, "Place search isn't working right now, try again in a moment.");
  assert.notEqual(PLACE_DOWN_TEXT, PLACE_BUSY_TEXT);
  assert.notEqual(PLACE_DOWN_TEXT, PLACE_EMPTY_TEXT);
  const cases: { label: string; fetchImpl: typeof fetch }[] = [
    { label: "429", fetchImpl: (async () => new Response("no", { status: 429 })) as unknown as typeof fetch },
    { label: "503", fetchImpl: (async () => new Response("no", { status: 503 })) as unknown as typeof fetch },
    { label: "network", fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch },
    { label: "timeout", fetchImpl: (async () => { throw new DOMException("The operation was aborted.", "TimeoutError"); }) as unknown as typeof fetch },
  ];
  for (const c of cases) {
    let t = 0;
    const lookup = makePlaceSearch({
      fetchImpl: c.fetchImpl,
      now: () => t,
      sleep: async (ms) => { t += ms; },
      baseUrl: "https://example.test/search",
    });
    const answer = await lookup.lookup("halifax");
    assert.equal(answer.busy, false, c.label);
    assert.equal(answer.failed, true, c.label);
    assert.equal(answer.hits.length, 0, c.label);
    assert.equal(placeAnswerText(answer), PLACE_DOWN_TEXT, c.label);
  }
  // Failures are not cached: a later success for the same query still goes upstream.
  let calls = 0;
  let t = 0;
  let mode: "fail" | "ok" = "fail";
  const lookup = makePlaceSearch({
    fetchImpl: (async () => {
      calls++;
      if (mode === "fail") return new Response("no", { status: 429 });
      return Response.json([{ display_name: "Halifax, NS", lat: "44.65", lon: "-63.58" }]);
    }) as unknown as typeof fetch,
    now: () => t,
    sleep: async (ms) => { t += ms; },
    baseUrl: "https://example.test/search",
  });
  assert.equal((await lookup.lookup("halifax")).failed, true);
  mode = "ok";
  const again = await lookup.lookup("halifax");
  assert.equal(again.failed, undefined);
  assert.equal(again.hits.length, 1);
  assert.equal(calls, 2);
  assert.equal(placeAnswerText({ hits: [], busy: false }), PLACE_EMPTY_TEXT);
  assert.equal(placeAnswerText({ hits: [], busy: true }), PLACE_BUSY_TEXT);
  assert.equal(placeAnswerText({ hits: [], busy: true, failed: true }), PLACE_BUSY_TEXT, "queue busy wins over failed");
});

// --- (6) multi-buy unchanged ------------------------------------------------------------------------
test("k2-r2-6: need 9 on a 5-for stays exact (no extra bought)", () => {
  const avocado = P("Hass Avocado", "1 ea", 1.69, { each: 1 , dealCount: 5, dealCad: 3.99 });
  // coverNeed reads dealCount/dealCad from the product; shelf deals may be set differently.
  const line = L("avocado", 9, "");
  const c = coverNeed(avocado, line);
  assert.equal(c?.packs, 9);
  assert.equal(c?.totalCad, 10.75);
  assert.equal(c?.deal, "5 for $3.99 + 4 × $1.69");
});
