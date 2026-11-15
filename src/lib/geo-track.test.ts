import assert from "node:assert/strict";
import test from "node:test";
import { destinationPoint, fitZoom, haversine, pathMeters, simplifyRoute, tileToWorld, worldToTile } from "./geo-track.ts";

test("one degree of longitude at the equator is about 111 km", () => {
  const meters = haversine({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
  assert.ok(meters > 110_000 && meters < 112_000, String(meters));
});

test("a path sums its legs", () => {
  const meters = pathMeters([
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.01 },
    { lat: 0, lng: 0.02 },
  ]);
  const one = haversine({ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 });
  assert.ok(Math.abs(meters - one * 2) < 1);
});

test("north one kilometre stays on the meridian", () => {
  const point = destinationPoint({ lat: 45, lng: -66 }, 0, 1000);
  assert.ok(Math.abs(point.lng + 66) < 0.01);
  assert.ok(point.lat > 45);
  const back = haversine({ lat: 45, lng: -66 }, point);
  assert.ok(Math.abs(back - 1000) < 5, String(back));
});

test("tile projection round-trips", () => {
  const tile = worldToTile(47.6, -65.65, 15);
  const back = tileToWorld(tile.x, tile.y, 15);
  assert.ok(Math.abs(back.lat - 47.6) < 0.0001);
  assert.ok(Math.abs(back.lng + 65.65) < 0.0001);
});

test("simplify keeps the ends and a cap", () => {
  const points = Array.from({ length: 200 }, (_, i) => ({ lat: i / 1000, lng: i / 1000 }));
  const slim = simplifyRoute(points, 10);
  assert.equal(slim.length, 10);
  assert.equal(slim[0]!.lat, 0);
  assert.equal(slim.at(-1)!.lat, 0.199);
});

test("fitZoom keeps a kilometre-long run inside the screen", () => {
  const start = { lat: 47.6, lng: -65.65 };
  const end = destinationPoint(start, 0, 1200);
  const view = fitZoom([start, end], 390, 640);
  assert.ok(view.zoom >= 13 && view.zoom <= 16, String(view.zoom));
  assert.ok(view.center.lat > start.lat && view.center.lat < end.lat);
});
