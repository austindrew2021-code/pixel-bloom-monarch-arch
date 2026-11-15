import assert from "node:assert/strict";
import test from "node:test";
import { pickExact, UNCHECKED_LABEL_REASON, type MatchProduct } from "./grocery-match.ts";
import { catalogPick, normalizeNeedLine } from "./grocery-pick.ts";
import { liveStoreResult } from "./grocery-pcx.server.ts";
import { cartFillAnnounced, fillingLabel } from "./grocery-cart.ts";
import { createBackCloser, type BackWindow } from "./back-close.ts";
import { checkUnlock, gateView, GATE_TIMEOUT_MS, runStartupGate } from "./gate-view.ts";
import { rehydrateOnce, safeRehydrate } from "./safe-rehydrate.ts";
import { isTesterUnlocked } from "./tester.ts";
import { matchCart, splitTypedAmount } from "./grocery-pick.ts";
import { cooksLabel } from "./cook-label.ts";
import { isWeeknight, weeknightSafe, WEEKNIGHT_MAX_MINUTES } from "./sample-week.ts";
import type { PlannedMeal, Recipe } from "./types";

// --- 3a: no-ingredient-data refusals don't blame the cook; still fail closed -------------------
const butter = (name: string, extra: Partial<MatchProduct> = {}): MatchProduct =>
  ({ name, sizeLabel: "454 g", priceCad: 5.99, grams: 454, ...extra }) as MatchProduct;

test("3a: staple with no ingredient list under an allergy -> neutral wording, nothing picked", () => {
  const r = pickExact({
    line: { name: "unsalted butter", qty: 1, unit: "cup", aisle: "Dairy & Eggs" },
    products: [butter("Gay Lea Unsalted Butter")],
    profile: { allergies: ["egg"], prefs: [] },
    gramsPerCup: 227,
  });
  assert.equal(r.status, "ask");
  assert.equal(r.pick, null);
  assert.equal(r.reason, "We couldn't check what's in this, so we left it off to keep your settings safe.");
  assert.equal(r.reason, UNCHECKED_LABEL_REASON);
  assert.doesNotMatch(r.reason, /your allergy or diet settings/);
});

test("3a: same with a diet only (pescatarian), still refused", () => {
  const r = pickExact({
    line: { name: "unsalted butter", qty: 1, unit: "cup", aisle: "Dairy & Eggs" },
    products: [butter("Gay Lea Unsalted Butter")],
    profile: { allergies: [], prefs: ["pescatarian"] },
    gramsPerCup: 227,
  });
  assert.equal(r.status, "ask");
  assert.equal(r.reason, UNCHECKED_LABEL_REASON);
});

test("3a: a real allergen hit keeps the existing wording", () => {
  const r = pickExact({
    line: { name: "unsalted butter", qty: 1, unit: "cup", aisle: "Dairy & Eggs" },
    products: [butter("Gay Lea Unsalted Butter", { ingredients: "Cream, milk." })],
    profile: { allergies: ["dairy"], prefs: [] },
    gramsPerCup: 227,
  });
  assert.equal(r.status, "ask");
  assert.equal(r.reason, "Every match failed your allergy or diet settings. Nothing was picked.");
});

test("3a: packed catalog (no ingredient data) with an allergy set: neutral wording, no pick", () => {
  const r = catalogPick({ brand: "superstore", name: "Atlantic Superstore" }, { name: "milk", qty: 1, unit: "L", aisle: "Dairy & Eggs" }, { allergies: ["egg"], prefs: [] });
  assert.equal(r.status, "ask");
  assert.equal(r.reason, UNCHECKED_LABEL_REASON);
});

// --- 3b: amounts in the typed name don't sink the search ---------------------------------------
test("3b: normalizeNeedLine moves a trailing or leading amount into qty/unit", () => {
  const base = { qty: 1, unit: "", aisle: "Other" as const };
  assert.deepEqual(normalizeNeedLine({ ...base, name: "salmon fillets ¾ lb" }), { ...base, name: "salmon fillets", qty: 0.75, unit: "lb" });
  assert.deepEqual(normalizeNeedLine({ ...base, name: "¾ lb salmon fillets" }), { ...base, name: "salmon fillets", qty: 0.75, unit: "lb" });
  assert.deepEqual(normalizeNeedLine({ ...base, name: "ground beef 1 1/2 lbs" }), { ...base, name: "ground beef", qty: 1.5, unit: "lb" });
  assert.deepEqual(normalizeNeedLine({ ...base, name: "chicken thighs 600g" }), { ...base, name: "chicken thighs", qty: 600, unit: "g" });
  assert.deepEqual(normalizeNeedLine({ ...base, name: "2 cans diced tomatoes" }), { ...base, name: "diced tomatoes", qty: 2, unit: "cans" });
});

test("3b: normalizeNeedLine leaves structured lines and lookalikes alone, never qty 0", () => {
  const keep = [
    { name: "salmon fillets", qty: 0.75, unit: "lb", aisle: "Other" as const },
    { name: "2% milk", qty: 1, unit: "", aisle: "Other" as const },
    { name: "5 spice powder", qty: 1, unit: "", aisle: "Other" as const },
    { name: "omega 3 eggs", qty: 1, unit: "", aisle: "Other" as const },
    { name: "1 lb", qty: 1, unit: "", aisle: "Other" as const },
    { name: "salmon 0 lb", qty: 1, unit: "", aisle: "Other" as const },
    { name: "salmon fillets ¾ lb", qty: 2, unit: "", aisle: "Other" as const },
  ];
  for (const line of keep) assert.deepEqual(normalizeNeedLine(line), line, line.name);
});

const tile = (title: string, size: string, price: number, brand = "") => ({ productId: title.replace(/\W+/g, "_") + size.replace(/\W+/g, ""), brand, title, packageSizing: size, pricing: { price: String(price) } });

async function withTiles<T>(tiles: unknown[], run: (queries: string[]) => Promise<T>): Promise<T> {
  const saved = process.env.SPOONFUL_PCX_API_KEY;
  const real = globalThis.fetch;
  const queries: string[] = [];
  process.env.SPOONFUL_PCX_API_KEY = "dummy-test-key";
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (!String(url).includes("/products/search")) return new Response("null", { status: 404 });
    queries.push(String(init?.body ?? ""));
    return new Response(JSON.stringify({ layout: { sections: { mainContentCollection: { components: [{ data: { productTiles: tiles } }] } } } }), { status: 200 });
  }) as typeof fetch;
  try {
    return await run(queries);
  } finally {
    globalThis.fetch = real;
    if (saved === undefined) delete process.env.SPOONFUL_PCX_API_KEY;
    else process.env.SPOONFUL_PCX_API_KEY = saved;
  }
}

test("3b: 'salmon fillets ¾ lb' finds salmon fillet products (live search, fixture tiles)", async () => {
  const tiles = [tile("Atlantic Salmon Fillet Fresh", "454 g", 12.99), tile("Frozen Atlantic Salmon Fillets", "454 g", 9.99, "PC"), tile("Smoked Salmon", "300 g", 8.99)];
  await withTiles(tiles, async (queries) => {
    const r = await liveStoreResult({ store: { brand: "superstore", name: "Atlantic Superstore" }, line: { name: "salmon fillets ¾ lb", qty: 1, unit: "", aisle: "Other" }, storeId: "0357" });
    assert.equal(r.status, "pick");
    assert.match(r.options[0]!.name, /Salmon Fillet/);
    assert.ok(!/Smoked/.test(r.options[0]!.name));
    assert.ok(queries.every((q) => !/\blb\b|¾/.test(q)), "amount is not sent as search words");
  });
});

test("3b: cut rules still hold after normalization (bone-in vs boneless asks)", async () => {
  const tiles = [tile("Pork Loin Chops Bone In", "700 g", 7.99), tile("Boneless Pork Loin Chops", "600 g", 9.49)];
  await withTiles(tiles, async () => {
    const r = await liveStoreResult({ store: { brand: "superstore", name: "Atlantic Superstore" }, line: { name: "pork chops 1 lb", qty: 1, unit: "", aisle: "Other" }, storeId: "0357" });
    assert.equal(r.status, "ask");
    assert.match(r.reason, /bone-in or boneless/);
  });
});

// --- 4: carts off -> no "Cart is filling" ---------------------------------------------------------
test("4: with cart-disabled, no filling toast and the button never says 'Filling the cart…'", () => {
  assert.equal(cartFillAnnounced(true, true), false);
  assert.notEqual(fillingLabel(true, true), "Filling the cart…");
  assert.equal(cartFillAnnounced(true, false), true);
  assert.equal(fillingLabel(true, false), "Filling the cart…");
});

// --- 6: Back closes the card ---------------------------------------------------------------------
function fakeWindow() {
  const stack: unknown[] = [{ __TSR_index: 0 }];
  let i = 0;
  const listeners = new Set<() => void>();
  const win: BackWindow & { stack: unknown[]; index: () => number; pressBack: () => void } = {
    history: {
      get state() {
        return stack[i];
      },
      pushState(data: unknown) {
        stack.splice(i + 1);
        stack.push(data);
        i += 1;
      },
      replaceState(data: unknown) {
        stack[i] = data;
      },
      back() {
        win.pressBack();
      },
    },
    addEventListener: (_t, fn) => listeners.add(fn),
    removeEventListener: (_t, fn) => listeners.delete(fn),
    stack,
    index: () => i,
    pressBack() {
      if (i === 0) return;
      i -= 1;
      for (const fn of [...listeners]) fn();
    },
  };
  return win;
}

test("6: opening a card pushes one entry; Back closes it and stays in the app", () => {
  const win = fakeWindow();
  let closed = 0;
  const c = createBackCloser(win, () => closed++);
  c.open();
  assert.equal(win.index(), 1);
  win.pressBack();
  assert.equal(closed, 1);
  assert.equal(win.index(), 0, "back landed on the app's own entry, not outside");
  assert.equal(c.isOpen, false);
});

const tick = () => new Promise((r) => setTimeout(r, 5));

test("6: closing from the UI removes the entry, without calling the close handler again", async () => {
  const win = fakeWindow();
  let closed = 0;
  const c = createBackCloser(win, () => closed++);
  c.open();
  c.close();
  await tick();
  assert.equal(win.index(), 0);
  assert.equal(closed, 0);
  c.close();
  assert.equal(win.index(), 0, "close twice is a no-op");
});

test("6: APK hands Back to the WebView while it can go back", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../../android-test/app/src/main/java/kitchen/spoonful/MainActivity.java", import.meta.url), "utf8");
  assert.match(src, /web\.canGoBack\(\)\)\s*\{\s*web\.goBack\(\);/);
});

// --- 7a: cold start ----------------------------------------------------------------------------
test("7a: pending check paints a splash, not the gate; then gate or app", () => {
  assert.equal(gateView(null), "splash");
  assert.equal(gateView(false), "gate");
  assert.equal(gateView(true), "app");
});

// --- 7b: sample week ---------------------------------------------------------------------------
const R = (id: string, minutes: number) => ({ id, name: id, minutes }) as Recipe;

test("7b: a long weeknight dinner swaps to Sunday; deterministic", () => {
  // 2026-11-09 is a Monday.
  const dates = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
  const ids = ["a", "b", "hd-prime-rib", "c", "d", "e", "f"];
  const book = new Map<string, Recipe>([["hd-prime-rib", R("hd-prime-rib", 180)], ...["a", "b", "c", "d", "e", "f"].map((x) => [x, R(x, 30)] as [string, Recipe])]);
  const meals: PlannedMeal[] = dates.map((date, n) => ({ id: `m${n}`, date, slot: "dinner", recipeId: ids[n] }));
  const once = weeknightSafe(meals, dates, (id) => book.get(id));
  const twice = weeknightSafe(meals, dates, (id) => book.get(id));
  assert.deepEqual(once, twice);
  assert.equal(once.find((m) => m.date === "2026-11-15")!.recipeId, "hd-prime-rib");
  assert.equal(once.find((m) => m.date === "2026-11-11")!.recipeId, "f");
  for (const m of once) if (isWeeknight(m.date)) assert.ok(book.get(m.recipeId!)!.minutes <= WEEKNIGHT_MAX_MINUTES);
  assert.equal(meals[2]!.recipeId, "hd-prime-rib", "input not mutated");
});

test("7b: no quick weekend slot -> first unused quick recipe from the pool", () => {
  const dates = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
  const book = new Map<string, Recipe>(["L1", "L2", "L3", "L4"].map((x) => [x, R(x, 120)] as [string, Recipe]));
  const meals: PlannedMeal[] = [
    { id: "w", date: "2026-11-11", slot: "dinner", recipeId: "L1" },
    { id: "f", date: "2026-11-13", slot: "dinner", recipeId: "L2" },
    { id: "s", date: "2026-11-14", slot: "dinner", recipeId: "L3" },
    { id: "u", date: "2026-11-15", slot: "dinner", recipeId: "L4" },
  ];
  const pool = [R("L9", 90), R("q1", 25), R("q2", 20)];
  const out = weeknightSafe(meals, dates, (id) => book.get(id) ?? pool.find((p) => p.id === id), pool);
  assert.equal(out.find((m) => m.id === "w")!.recipeId, "q1");
});

test("7b: weeknights are Mon–Thu", () => {
  assert.deepEqual(["2026-11-08", "2026-11-09", "2026-11-12", "2026-11-13", "2026-11-14"].map(isWeeknight), [false, true, true, false, false]);
});

// --- 7c ----------------------------------------------------------------------------------------
test("7c: 'You cook', others 'Name cooks'", () => {
  assert.equal(cooksLabel("You"), "You cook");
  assert.equal(cooksLabel("Sam"), "Sam cooks");
});

// =============================== r2 ===============================

// r2-3: Cook mode uses the same Back entry. Card → "Cook this" in one commit must not let the
// card's late pop close Cook mode; Back then closes Cook mode and stays in the app.
test("r2-3: card closes and Cook mode opens in one commit: Cook mode takes over the entry", async () => {
  const win = fakeWindow();
  let cardClosed = 0;
  let cookClosed = 0;
  const card = createBackCloser(win, () => cardClosed++);
  const cook = createBackCloser(win, () => cookClosed++);
  card.open();
  card.close(); // React cleanup of the card ...
  cook.open(); // ... then Cook mode's mount effect, same commit
  await tick();
  assert.equal(cookClosed, 0, "the card's pop was cancelled");
  assert.equal(win.index(), 1, "one entry, now Cook mode's");
  win.pressBack();
  assert.equal(cookClosed, 1, "Back closes Cook mode");
  assert.equal(win.index(), 0, "and lands on the app, not outside it");
  assert.equal(cardClosed, 0);
});

test("r2-3: CookView wires useBackToClose", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../components/cook-view.tsx", import.meta.url), "utf8");
  assert.match(src, /useBackToClose\(true, onClose\)/);
});

// r2-2: 7a fail closed.
function fakeTimers() {
  const fns: (() => void)[] = [];
  return { schedule: (fn: () => void) => (fns.push(fn), fns.length), clear: () => {}, fire: () => fns.splice(0).forEach((f) => f()) };
}
function stateBox() {
  let v: boolean | null = null;
  return { set: (fn: (p: boolean | null) => boolean | null) => (v = fn(v)), get: () => v };
}

test("r2-7a: blocked storage (localStorage throws) -> locked -> gate", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document, location: g.location };
  const thrower = () => {
    throw new DOMException("blocked", "SecurityError");
  };
  const win = { location: { search: "", hostname: "spoonful.example" }, parent: null as unknown };
  win.parent = win;
  Object.defineProperty(win, "localStorage", { get: thrower });
  g.window = win;
  g.document = { referrer: "" };
  g.location = win.location;
  const ls = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { get: thrower, configurable: true });
  try {
    assert.equal(checkUnlock(isTesterUnlocked), false);
    const t = fakeTimers();
    const box = stateBox();
    runStartupGate({ check: isTesterUnlocked, startup: async () => true, set: box.set, schedule: t.schedule, clear: t.clear });
    assert.equal(gateView(box.get()), "gate");
  } finally {
    if (ls) Object.defineProperty(globalThis, "localStorage", ls);
    else delete (globalThis as Record<string, unknown>).localStorage;
    g.window = saved.window;
    g.document = saved.document;
    g.location = saved.location;
  }
});

test("r2-7a: the unlock check throws -> gate", () => {
  const t = fakeTimers();
  const box = stateBox();
  runStartupGate({ check: () => { throw new TypeError("boom"); }, startup: async () => true, set: box.set, schedule: t.schedule, clear: t.clear });
  assert.equal(gateView(box.get()), "gate");
});

test("r2-7a: unlocked but the startup (rehydrate) throws or fails -> gate, never the app", async () => {
  for (const startup of [
    () => {
      throw new TypeError("Cannot read properties of undefined (reading 'rehydrate')");
    },
    async () => {
      throw new Error("storage");
    },
    async () => false,
  ]) {
    const t = fakeTimers();
    const box = stateBox();
    runStartupGate({ check: () => true, startup: startup as () => Promise<boolean>, set: box.set, schedule: t.schedule, clear: t.clear });
    await tick();
    assert.equal(gateView(box.get()), "gate");
  }
});

test("r2-7a: no answer within the timeout -> gate; a late clean unlock may still open the app", async () => {
  assert.ok(GATE_TIMEOUT_MS >= 2000 && GATE_TIMEOUT_MS <= 4000);
  const t = fakeTimers();
  const box = stateBox();
  let finish!: (v: boolean) => void;
  runStartupGate({ check: () => true, startup: () => new Promise<boolean>((r) => (finish = r)), set: box.set, schedule: t.schedule, clear: t.clear });
  assert.equal(gateView(box.get()), "splash");
  t.fire();
  assert.equal(gateView(box.get()), "gate", "timed out: gate, not the app");
  finish(true);
  await tick();
  assert.equal(gateView(box.get()), "app");
});

test("r2-7a: unlocked + good startup -> app; timer after that changes nothing", async () => {
  const t = fakeTimers();
  const box = stateBox();
  runStartupGate({ check: () => true, startup: async () => true, set: box.set, schedule: t.schedule, clear: t.clear });
  await tick();
  assert.equal(gateView(box.get()), "app");
  t.fire();
  assert.equal(gateView(box.get()), "app");
});

test("r2-7a: safeRehydrate guards a missing persist API and a throwing rehydrate", async () => {
  assert.equal(await safeRehydrate({}), false);
  assert.equal(await safeRehydrate({ persist: undefined }), false);
  assert.equal(await safeRehydrate({ persist: { rehydrate: () => { throw new Error("x"); } } }), false);
  assert.equal(await safeRehydrate({ persist: { rehydrate: () => Promise.reject(new Error("x")) } }), false);
  assert.equal(await safeRehydrate({ persist: { rehydrate: () => undefined } }), true);
  let calls = 0;
  const store = { persist: { rehydrate: () => void calls++ } };
  await rehydrateOnce(store);
  await rehydrateOnce(store);
  assert.equal(calls, 1);
});

test("r2-7a: spoonful-app server HTML carries the gate in <noscript> and hides the splash mark", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../components/spoonful-app.tsx", import.meta.url), "utf8");
  assert.match(src, /<noscript>[\s\S]*spoonful-splash-mark\{display:none\}[\s\S]*<TesterGate/);
  assert.match(src, /runStartupGate\(/);
  assert.doesNotMatch(src, /useSpoonful\.persist\.rehydrate/);
  const store = await readFile(new URL("./spoonful-store.ts", import.meta.url), "utf8");
  assert.doesNotMatch(store, /useSpoonful\.persist\.rehydrate/, "module-level rehydrate is guarded too");
  assert.match(store, /void safeRehydrate\(useSpoonful\)/);
});

// r2-4: no ping promise with carts off.
test("r2-4: carts off -> notify-me hidden (cartFillAnnounced false) for the Superstore sheet", async () => {
  assert.equal(cartFillAnnounced(true, true), false);
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../components/grocery-near.tsx", import.meta.url), "utf8");
  assert.match(src, /leftover\.length > 0 && !noPing \?/);
});

// r2-5: parsed amounts show in the normal format.
test("r2-5: typed shop line splits into name + amount; never qty 0", () => {
  assert.deepEqual(splitTypedAmount("salmon fillets ¾ lb"), { name: "salmon fillets", amount: { qty: 0.75, unit: "lb" } });
  assert.deepEqual(splitTypedAmount("  2 cans diced tomatoes "), { name: "diced tomatoes", amount: { qty: 2, unit: "cans" } });
  assert.deepEqual(splitTypedAmount("milk"), { name: "milk" });
  assert.deepEqual(splitTypedAmount("salmon 0 lb"), { name: "salmon 0 lb" });
  assert.deepEqual(splitTypedAmount("1 lb"), { name: "1 lb" });
});

test("r2-5: a saved raw line shows the parsed qty/unit in the picker (pickForLine)", () => {
  const { items } = matchCart({ brand: "superstore", name: "Atlantic Superstore" }, [{ name: "salmon fillets ¾ lb", qty: 1, unit: "", aisle: "Other" }]);
  assert.equal(items[0]!.name, "salmon fillets");
  assert.equal(items[0]!.qty, 0.75);
  assert.equal(items[0]!.unit, "lb");
});
