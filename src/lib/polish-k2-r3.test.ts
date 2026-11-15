// k2 r3 (Kitchen + Ship rulings, Nov 15): (1) Fill stops at the first failed add or create;
// (2) oz-can table size first, else 0 to +10% over; (3) applesauce / Apple Sauce both ways;
// (4) copy: one period, no "….", pack counts are packs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  addUntilFirstFailure,
  itemsNeedPickText,
  nothingAddedText,
  packCountOf,
  packsInCartText,
  storeAddFailedText,
} from "./grocery-cart.ts";
import {
  canMatchesOz,
  canMatchesOzOver,
  canMatchesOzTable,
  pickExact,
  type MatchProduct,
} from "./grocery-match.ts";
import { isRelevantProduct, type CartNeed } from "./grocery-pick.ts";

const src = (rel: string) => readFile(new URL(rel, import.meta.url), "utf8");
const L = (name: string, qty: number, unit: string, aisle = "Pantry") => ({ name, qty, unit, aisle }) as CartNeed;
const P = (name: string, sizeLabel: string, priceCad: number, extra: Partial<MatchProduct> = {}) =>
  ({ brand: "superstore", name, sizeLabel, priceCad, ingredients: extra.ingredients ?? "Tomatoes, salt.", ...extra }) as unknown as MatchProduct;
const ml = (n: number, priceCad: number, title = "No Name Diced Tomatoes") =>
  P(title, `${n} mL`, priceCad, { ml: n });

// --- (1) stop at the first failed add or create ------------------------------------------------------
test("k2-r3-1: addUntilFirstFailure stops at the first failure; failing on pack k sends exactly k requests", async () => {
  for (const k of [1, 2, 5, 20]) {
    const calls: number[] = [];
    const items = Array.from({ length: 25 }, (_, i) => i + 1);
    const { added, wanted } = await addUntilFirstFailure(items, async (n) => {
      calls.push(n);
      return n !== k;
    });
    assert.equal(calls.length, k, `fail at ${k}: requests`);
    assert.deepEqual(calls, items.slice(0, k));
    assert.equal(added, k - 1);
    assert.equal(wanted, 25);
  }
});

test("k2-r3-1: a failing store add on pack k sends exactly k add requests and no further creates", async () => {
  const realFetch = globalThis.fetch;
  try {
    const calls: { action: string }[] = [];
    let adds = 0;
    (globalThis as { fetch: typeof fetch }).fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { action?: string };
      calls.push({ action: String(body.action) });
      if (body.action === "create") {
        return Response.json({ ok: true, cartId: "a1b2c3d4-0000-4000-8000-000000000001", cartToken: "tok1" });
      }
      if (body.action === "add") {
        adds++;
        return Response.json({ ok: adds !== 3, count: adds, lines: [] });
      }
      return Response.json({ ok: true });
    }) as typeof fetch;
    const mk = () => {
      const m = new Map<string, string>();
      return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    };
    (globalThis as Record<string, unknown>).localStorage = mk();
    (globalThis as Record<string, unknown>).sessionStorage = mk();
    const C = await import(`./grocery-cart.ts?r3add=${Math.random()}`);
    const store = { id: "ss-r3-add", brand: "superstore", name: "Real Canadian Superstore Halifax", pcStoreId: "4321", lat: 44.6, lon: -63.6 } as never;
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `2174118${String(i).padStart(2, "0")}_EA`, packs: 1 }));
    const { added, wanted } = await C.addUntilFirstFailure(items, async (item: { id: string; packs: number }) => (await C.addToStoreCart(store, [item])).ok);
    assert.equal(wanted, 20);
    assert.equal(added, 2);
    assert.equal(calls.filter((c) => c.action === "add").length, 3, "exactly k add requests when pack k fails");
    assert.equal(calls.filter((c) => c.action === "create").length, 1);
    assert.ok(!calls.slice(calls.findIndex((c) => c.action === "add") + 3).some((c) => c.action === "add" || c.action === "create"));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("k2-r3-1: a failing cart create is one create, zero adds, even across 20+ lines", async () => {
  const realFetch = globalThis.fetch;
  try {
    const calls: { action: string }[] = [];
    (globalThis as { fetch: typeof fetch }).fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { action?: string };
      calls.push({ action: String(body.action) });
      if (body.action === "create") return new Response("boom", { status: 502 });
      if (body.action === "add") return Response.json({ ok: true, count: 1, lines: [] });
      return Response.json({ ok: true });
    }) as typeof fetch;
    const mk = () => {
      const m = new Map<string, string>();
      return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    };
    (globalThis as Record<string, unknown>).localStorage = mk();
    (globalThis as Record<string, unknown>).sessionStorage = mk();
    const C = await import(`./grocery-cart.ts?r3create=${Math.random()}`);
    const store = { id: "ss-r3-create", brand: "superstore", name: "Real Canadian Superstore Halifax", pcStoreId: "8765", lat: 44.6, lon: -63.6 } as never;
    const items = Array.from({ length: 22 }, (_, i) => ({ id: `2174119${String(i).padStart(2, "0")}_EA`, packs: 1 }));
    const { added, wanted } = await C.addUntilFirstFailure(items, async (item: { id: string; packs: number }) => (await C.addToStoreCart(store, [item])).ok);
    assert.equal(wanted, 22);
    assert.equal(added, 0);
    assert.equal(calls.filter((c) => c.action === "create").length, 1, "one create attempt");
    assert.equal(calls.filter((c) => c.action === "add").length, 0, "no add requests after a failed create");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("k2-r3-1: addAll uses addUntilFirstFailure (no continue past a failed pushStore)", async () => {
  const s = await src("../components/grocery-near.tsx");
  const add = s.slice(s.indexOf("async function addAll"), s.indexOf("async function fillAndNotify"));
  assert.match(add, /addUntilFirstFailure\(packed,/);
  assert.doesNotMatch(add, /if \(!ok\) continue/);
  assert.match(add, /storeAddFailedText\(\{ added: addedPacks, wanted: wantedPacks \}\)/);
});

// --- (2) table size first, else 0 to +10% over -------------------------------------------------------
test("k2-r3-2: 14 oz takes 398 if present (even when 400 is cheaper), else 400; 19 oz takes 540 if present else 568", () => {
  const line14 = L("canned diced tomatoes (14 oz)", 1, "can");
  const c398 = ml(398, 2.00);
  const c400 = ml(400, 1.00);
  const both14 = pickExact({ line: line14, products: [c400, c398], profile: {} });
  assert.equal(both14.status, "pick");
  assert.equal(both14.pick?.product.ml, 398, "table size wins over a cheaper +10% can");
  const only400 = pickExact({ line: line14, products: [c400], profile: {} });
  assert.equal(only400.status, "pick");
  assert.equal(only400.pick?.product.ml, 400);
  const line19 = L("chickpeas (19 oz)", 1, "can");
  const c540 = P("No Name Chickpeas", "540 mL", 1.89, { ml: 540, ingredients: "Chickpeas, water, salt." });
  const c568 = P("No Name Chickpeas", "568 mL", 1.19, { ml: 568, ingredients: "Chickpeas, water, salt." });
  assert.equal(pickExact({ line: line19, products: [c568, c540], profile: {} }).pick?.product.ml, 540);
  assert.equal(pickExact({ line: line19, products: [c568], profile: {} }).pick?.product.ml, 568);
  assert.equal(canMatchesOzTable(398, 14), true);
  assert.equal(canMatchesOzTable(400, 14), false);
  assert.equal(canMatchesOzOver(400, 14), true);
  assert.equal(canMatchesOz(400, 14), true);
  assert.equal(canMatchesOzTable(540, 19), true);
  assert.equal(canMatchesOzTable(568, 19), false);
  assert.equal(canMatchesOzOver(568, 19), true);
});

test("k2-r3-2: never short; 15 oz still asks for 398; 28 oz picks 796 not 750", () => {
  assert.equal(pickExact({ line: L("canned diced tomatoes (15 oz)", 1, "can"), products: [ml(398, 1.29)], profile: {} }).status, "ask");
  const r28 = pickExact({ line: L("canned diced tomatoes (28 oz)", 1, "can"), products: [ml(750, 1.49), ml(796, 1.79)], profile: {} });
  assert.equal(r28.status, "pick");
  assert.equal(r28.pick?.product.ml, 796);
  assert.equal(pickExact({ line: L("canned diced tomatoes (28 oz)", 1, "can"), products: [ml(750, 1.49)], profile: {} }).status, "ask");
  assert.equal(canMatchesOz(398, 15), false);
  assert.equal(canMatchesOzOver(398, 15), false);
  assert.equal(canMatchesOz(750, 28), false);
  assert.equal(canMatchesOzTable(796, 28), true);
});

// --- (3) applesauce / Apple Sauce both ways ----------------------------------------------------------
test("k2-r3-3: 'applesauce' matches 'Apple Sauce' and the cheaper one wins either way", () => {
  assert.equal(isRelevantProduct("Apple Sauce", "applesauce"), true);
  assert.equal(isRelevantProduct("Applesauce", "apple sauce"), true);
  assert.equal(isRelevantProduct("Apple Sauce", "apple sauce"), true);
  assert.equal(isRelevantProduct("Applesauce", "applesauce"), true);
  const sauce = P("Apple Sauce", "796 mL", 2.29, { ml: 796, each: 1, ingredients: "Apples, water, sugar." });
  const oneWord = P("Applesauce", "796 mL", 2.49, { ml: 796, each: 1, ingredients: "Apples, water, sugar." });
  const r = pickExact({ line: L("applesauce", 1, "jar"), products: [oneWord, sauce], profile: {} });
  assert.equal(r.status, "pick");
  assert.equal(r.pick?.product.name, "Apple Sauce");
  assert.equal(r.pick?.cover.totalCad, 2.29);
  const only = pickExact({ line: L("applesauce", 1, "jar"), products: [sauce], profile: {} });
  assert.equal(only.status, "pick");
  assert.equal(only.pick?.product.name, "Apple Sauce");
  const other = pickExact({ line: L("apple sauce", 1, "jar"), products: [oneWord, sauce], profile: {} });
  assert.equal(other.pick?.product.name, "Apple Sauce");
});

// --- (4) copy ----------------------------------------------------------------------------------------
test("k2-r3-4: failed-add text has exactly one period; no doubled ellipsis; pack counts are packs", () => {
  assert.equal(storeAddFailedText(), "Couldn't add that to the store cart.");
  assert.equal(storeAddFailedText({ added: 0, wanted: 5 }), "Couldn't add that to the store cart.");
  assert.equal((storeAddFailedText().match(/\./g) ?? []).length, 1);
  assert.equal(storeAddFailedText({ added: 2, wanted: 5 }), "Couldn't add that to the store cart. 2 of 5 packs made it in.");
  const long = itemsNeedPickText(["cheddar", "ham", "provolone", "rye"]);
  assert.match(long, /provolone…$/);
  assert.doesNotMatch(long, /provolone…\./);
  assert.doesNotMatch(nothingAddedText({ unsure: ["cheddar", "ham", "provolone", "rye"] }), /…\./);
  assert.equal(nothingAddedText({ unsure: ["cheddar", "ham", "provolone", "rye"] }), "Nothing added yet. 4 items need your pick (no exact match): cheddar, ham, provolone…");
  assert.equal(packCountOf([{ packs: 2 }, { packs: 3 }, { packs: 1 }]), 6);
  assert.equal(packsInCartText(5, "Atlantic Superstore"), "5 packs are in the Atlantic Superstore cart.");
  assert.equal(packsInCartText(1, "Atlantic Superstore"), "1 pack is in the Atlantic Superstore cart.");
});
