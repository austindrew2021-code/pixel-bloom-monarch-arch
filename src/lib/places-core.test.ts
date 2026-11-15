import { test } from "node:test";
import assert from "node:assert/strict";
import { makePlaceSearch, PLACE_GAP_MS } from "./places-core.ts";

function rig() {
  let t = 0;
  const calls: number[] = [];
  const search = makePlaceSearch({
    baseUrl: "https://example.test/search",
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    fetchImpl: (async () => {
      calls.push(t);
      return new Response(JSON.stringify([{ display_name: "Point Pleasant Park, Halifax", lat: "44.62", lon: "-63.57" }]));
    }) as typeof fetch,
  });
  return { search, calls };
}

test("same query (any case/spacing) is served from cache, one upstream call", async () => {
  const { search, calls } = rig();
  await search("Point Pleasant");
  await search("  point   pleasant ");
  assert.equal(calls.length, 1);
});

test("different queries are spaced at least 1.1 s apart app-wide", async () => {
  const { search, calls } = rig();
  await Promise.all([search("a park"), search("b park"), search("c park")]);
  assert.equal(calls.length, 3);
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i] - calls[i - 1] >= PLACE_GAP_MS);
});

test("a failing upstream returns no hits and is not cached", async () => {
  let n = 0;
  const search = makePlaceSearch({
    baseUrl: "https://example.test/search",
    now: () => 0,
    sleep: async () => {},
    fetchImpl: (async () => {
      n++;
      throw new Error("down");
    }) as typeof fetch,
  });
  assert.deepEqual(await search("park"), []);
  await search("park");
  assert.equal(n, 2);
});
