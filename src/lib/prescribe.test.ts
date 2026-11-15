import assert from "node:assert/strict";
import test from "node:test";
import {
  proteinAdherence,
  proteinHold,
  prescribeCardio,
  repsForLoad,
  repWindow,
  scaleTargetDistance,
} from "./prescribe.ts";

test("repsForLoad stays inside the day's range", () => {
  assert.equal(repsForLoad(80, 100, 6, 10), 8);
  assert.equal(repsForLoad(90, 100, 6, 10), 6);
  assert.equal(repsForLoad(70, 100, 6, 10), 10);
});

test("a weight at the estimated max does not invent a long set", () => {
  assert.equal(repsForLoad(100, 100, 6, 10), 5);
});

test("repWindow keeps a written range and opens a band around a single number", () => {
  assert.deepEqual(repWindow("6-8", "lose"), { min: 6, max: 8, timed: false });
  assert.deepEqual(repWindow("5", "lose"), { min: 4, max: 8, timed: false });
  assert.equal(repWindow("30-45s", "lose").timed, true);
});

test("protein hold waits for two logged days and ignores a single miss", () => {
  assert.equal(proteinAdherence([{ eaten: 40, target: 140 }]), null);
  assert.equal(proteinHold([{ eaten: 40, target: 140 }, { eaten: 0, target: 140 }]), false);
  assert.equal(proteinHold([{ eaten: 80, target: 140 }, { eaten: 90, target: 140 }]), true);
  assert.equal(proteinHold([{ eaten: 130, target: 140 }, { eaten: 150, target: 140 }]), false);
});

test("first cardio session is time only", () => {
  const rx = prescribeCardio({ planMinutes: 30, kind: "run", goalKind: "lose", recent: [] });
  assert.equal(rx.minutes, 30);
  assert.equal(rx.distanceKm, undefined);
});

test("a short night shortens the first session", () => {
  const rx = prescribeCardio({ planMinutes: 40, kind: "run", goalKind: "lose", recent: [], ease: true });
  assert.equal(rx.minutes, 30);
  assert.match(rx.note, /Short sleep/);
});

test("cardio grows time and sets distance from recent pace", () => {
  const rx = prescribeCardio({
    planMinutes: 30,
    kind: "run",
    goalKind: "lose",
    recent: [
      { minutes: 30, distanceKm: 5 },
      { minutes: 30, distanceKm: 5 },
    ],
  });
  assert.equal(rx.minutes, 35);
  assert.equal(rx.distanceKm, 5.8);
});

test("a short last session does not get a longer plan", () => {
  const rx = prescribeCardio({
    planMinutes: 40,
    kind: "ride",
    goalKind: "maintain",
    recent: [
      { minutes: 15, distanceKm: 5 },
      { minutes: 40, distanceKm: 16 },
      { minutes: 42, distanceKm: 16 },
    ],
  });
  assert.ok(rx.minutes < 40);
});

test("scaleTargetDistance follows the clock and caps a forgotten timer", () => {
  assert.equal(scaleTargetDistance(10, 40, 40), 10);
  assert.equal(scaleTargetDistance(10, 40, 20), 5);
  assert.equal(scaleTargetDistance(10, 40, 200), 15);
});
