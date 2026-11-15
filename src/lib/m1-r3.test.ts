import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { liveStoreResult } from "./grocery-pcx.server.ts";
import { makePlaceSearch, PLACE_MAX_QUEUED } from "./places-core.ts";

// m1 r3: Line's m1 r2 audit, findings 2–6. Pricing (finding 1) is in grocery-pricing.test.ts.
const src = (rel: string) => readFile(new URL(rel, import.meta.url), "utf8");

// --- 2: a store check stops Fill with no "Cart ready" / "Cart is filling" -----------------------------
test("r3-2: fillAndNotify stops after a blocked addAll (no Cart ready ping, no Cart is filling toast)", async () => {
  const s = await src("../components/grocery-near.tsx");
  // k2: addAll takes the deferred "Filling your cart" ping (onFirstPick); still Promise<boolean>.
  assert.match(s, /async function addAll\(onFirstPick\?: \(\) => Promise<void> \| void\): Promise<boolean>/);
  assert.match(s, /if \(blocked\) return false;/);
  const fill = s.slice(s.indexOf("async function fillAndNotify"));
  const filledAt = fill.indexOf("const filled = await addAll(");
  assert.ok(filledAt > 0);
  assert.ok(fill.indexOf("if (!filled || storeCartOff()) return;") > filledAt);
  assert.ok(fill.indexOf('notifyNative("Cart ready to review"') > fill.indexOf("if (!filled"));
  assert.ok(fill.indexOf('toast("Cart is filling') > fill.indexOf("if (!filled"));
  // No "Store check" toast either: the notice above the button is the only message.
  assert.doesNotMatch(s, /Store check — finish it on the store page/);
});

// --- 3: Back closes the Train / Fuel and Social overlays ---------------------------------------------
test("r3-3: FitnessApp (Train / Fuel) and SocialApp wire useBackToClose", async () => {
  for (const f of ["../components/fitness-app.tsx", "../components/social-app.tsx"]) {
    const s = await src(f);
    assert.match(s, /import \{ useBackToClose \} from "@\/lib\/back-close";/, f);
    assert.match(s, /useBackToClose\(true, onClose\)/, f);
  }
});

// --- 4: lazy, de-duplicated store carts --------------------------------------------------------------
type Call = { action: string; storeId?: string };
async function cartRig(answer: (body: Record<string, unknown>, n: number) => Record<string, unknown>) {
  const calls: Call[] = [];
  let n = 0;
  (globalThis as { fetch: typeof fetch }).fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ action: String(body.action), storeId: body.storeId as string | undefined });
    await new Promise((r) => setTimeout(r, 10));
    n++;
    return Response.json(answer(body, n));
  }) as typeof fetch;
  const mk = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };
  (globalThis as Record<string, unknown>).localStorage = mk();
  (globalThis as Record<string, unknown>).sessionStorage = mk();
  const C = await import(`./grocery-cart.ts?r3=${Math.random()}`);
  return { C, calls };
}
const store = (id: string, pcStoreId: string) =>
  ({ id, brand: "superstore", name: "Real Canadian Superstore Halifax", pcStoreId, lat: 44.6, lon: -63.6 }) as never;

test("r3-4: opening the sheet only checks carts-on (no create); the first add creates once; concurrent creates share one", async () => {
  const realFetch = globalThis.fetch;
  try {
    const { C, calls } = await cartRig((body, n) =>
      body.action === "create"
        ? { ok: true, cartId: `a1b2c3d4-0000-4000-8000-00000000000${n}`, cartToken: `tok${n}` }
        : body.action === "add"
          ? { ok: true, count: 1, lines: [] }
          : { ok: true },
    );
    const s1 = store("ss-1", "1234");
    assert.equal(await C.storeCartStatus(s1), true);
    await C.storeCartStatus(s1);
    assert.deepEqual(calls.map((c) => c.action), ["status"], "open: one status check, no cart");
    const res = await C.addToStoreCart(s1, [{ id: "21741185_EA", packs: 1 }]);
    assert.equal(res.ok, true);
    assert.deepEqual(calls.map((c) => c.action), ["status", "create", "add"], "cart made on the first add");
    await C.addToStoreCart(s1, [{ id: "21741185_EA", packs: 1 }]);
    assert.equal(calls.filter((c) => c.action === "create").length, 1, "saved cart reused");
    const s2 = store("ss-2", "5678");
    await Promise.all([C.ensureStoreCart(s2), C.ensureStoreCart(s2), C.addToStoreCart(s2, [{ id: "21741185_EA", packs: 2 }])]);
    assert.equal(calls.filter((c) => c.action === "create" && c.storeId === "5678").length, 1, "one in-flight create per store");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("r3-4: carts off stays cart-disabled: the status check turns carts off and no create or add is sent", async () => {
  const realFetch = globalThis.fetch;
  try {
    const { C, calls } = await cartRig(() => ({ ok: false, error: "cart-disabled" }));
    const s1 = store("ss-9", "9999");
    assert.equal(await C.storeCartStatus(s1), false);
    assert.equal(C.storeCartOff(), true);
    const res = await C.addToStoreCart(s1, [{ id: "21741185_EA", packs: 1 }]);
    assert.equal(res.ok, false);
    assert.deepEqual(calls.map((c) => c.action), ["status"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("r3-4: the cart API answers status after the cart-disabled check, before any store call", async () => {
  const s = await src("../routes/api/grocery-cart.ts");
  const off = s.indexOf('error: "cart-disabled"');
  const status = s.indexOf('=== "status"');
  const storeCall = s.indexOf("resolvePcxStoreId(");
  assert.ok(off > 0 && status > off && storeCall > status);
  const sheet = await src("../components/grocery-near.tsx");
  assert.doesNotMatch(sheet, /ensureStoreCart/);
});

// --- 5: place search ---------------------------------------------------------------------------------
test("r3-5: server keeps at most PLACE_MAX_QUEUED searches waiting; extra ones get [] with no upstream call", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  let upstream = 0;
  const search = makePlaceSearch({
    baseUrl: "https://example.test/search",
    now: () => 0,
    sleep: async () => {},
    fetchImpl: (async () => {
      upstream++;
      await gate;
      return new Response(JSON.stringify([{ display_name: "Park, Halifax", lat: "44.6", lon: "-63.5" }]));
    }) as typeof fetch,
  });
  const runs = Array.from({ length: PLACE_MAX_QUEUED + 3 }, (_, i) => search(`place ${i}`));
  const extra = await Promise.all(runs.slice(PLACE_MAX_QUEUED));
  assert.deepEqual(extra, [[], [], []]);
  release();
  const first = await Promise.all(runs.slice(0, PLACE_MAX_QUEUED));
  assert.equal(first.every((rows) => rows.length === 1), true);
  assert.equal(upstream, PLACE_MAX_QUEUED);
  assert.equal((await search("place again")).length, 1, "capacity comes back after the queue drains");
});

test("r3-5: the map search blocks Enter and the button while a search is in flight", async () => {
  const s = await src("../components/route-map.tsx");
  assert.match(s, /if \(query\.trim\(\)\.length < 2 \|\| searching \|\| searchBusy\.current\) return;/);
  assert.match(s, /e\.key === "Enter" && !searching/);
  assert.match(s, /disabled=\{searching\}/);
});

// --- 6: per-owner store check, 429 is "busy" ---------------------------------------------------------
test("r3-6: a 429 is 'busy', and one shopper's store check never blocks another shopper", async () => {
  const realFetch = globalThis.fetch;
  const savedKey = process.env.SPOONFUL_PCX_API_KEY;
  process.env.SPOONFUL_PCX_API_KEY = "dummy-test-key";
  const walled = new Set<string>();
  let searches = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (!String(url).includes("/products/search")) return new Response("{}", { status: 404 });
    searches++;
    const body = JSON.parse(String(init?.body ?? "{}")) as { userData?: { domainUserId?: string } };
    const who = body.userData?.domainUserId ?? "";
    if (walled.has(who)) return new Response("", { status: 429 });
    return Response.json({ layout: { sections: { mainContentCollection: { components: [{ data: { productTiles: [] } }] } } } });
  }) as typeof fetch;
  try {
    const { pcxIdentityFor } = await import("./grocery-owner.server.ts");
    const a = "shopperAAAAAAAAAAAAAAAA";
    const b = "shopperBBBBBBBBBBBBBBBB";
    walled.add(pcxIdentityFor(a).domainUserId);
    const ask = (shopper: string) =>
      liveStoreResult({ store: { brand: "superstore", name: "Atlantic Superstore" }, line: { name: "rice", qty: 1, unit: "", aisle: "Pantry" }, storeId: "0357", shopper });
    const ra = await ask(a);
    assert.equal(ra.blocked, true);
    assert.equal(ra.check, "busy");
    const before = searches;
    const ra2 = await ask(a);
    assert.equal(ra2.check, "busy");
    assert.equal(searches, before, "same shopper backs off: no new store search for 2 minutes");
    const rb = await ask(b);
    assert.equal(rb.blocked, undefined, "another shopper is not shown the first one's check");
    assert.equal(searches, before + 1);
  } finally {
    globalThis.fetch = realFetch;
    if (savedKey === undefined) delete process.env.SPOONFUL_PCX_API_KEY;
    else process.env.SPOONFUL_PCX_API_KEY = savedKey;
  }
});

test("r3-6: wording — busy vs person check", async () => {
  const { storeCheckNotice } = await import("./grocery-cart.ts");
  assert.equal(storeCheckNotice("busy", true), "The store is busy, try again in a minute.");
  assert.equal(storeCheckNotice("busy", false), "The store is busy, try again in a minute.");
  assert.match(storeCheckNotice("person", true), /confirm you’re a person.*tap Fill again/);
  assert.doesNotMatch(storeCheckNotice("person", false), /busy/);
});
