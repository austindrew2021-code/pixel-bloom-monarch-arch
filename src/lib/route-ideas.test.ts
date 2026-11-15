import assert from "node:assert/strict";
import test from "node:test";
import { haversine } from "./geo-track.ts";
import { closestChoice, distanceChoices, loopVias, routeTitle } from "./route-ideas.ts";

test("a loop corner sits near the tuned radius", () => {
  const start = { lat: 47.62, lng: -65.65 };
  const [a] = loopVias(start, 0, 5);
  const meters = haversine(start, a);
  assert.ok(Math.abs(meters - (5000 / 5.6)) < 40, String(meters));
});

test("route names use a street, or the compass when the path has none", () => {
  assert.equal(routeTitle(["", "Douglas Avenue"], 0), "North · Douglas Avenue");
  assert.equal(routeTitle(["unnamed"], 90), "East loop");
});

test("distance buttons stay few, and a planned run picks the nearest", () => {
  const run = distanceChoices("run", false);
  assert.deepEqual(run.map((item) => item.label), ["2 km", "5 km", "10 km"]);
  assert.equal(closestChoice(run, 8).label, "10 km");
  assert.equal(closestChoice(distanceChoices("ride", true)).label, "10 miles");
});
