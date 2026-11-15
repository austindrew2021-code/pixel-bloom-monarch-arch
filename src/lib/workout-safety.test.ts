import assert from "node:assert/strict";
import test from "node:test";
import { blankHealthDay, recoveryLabel } from "./fitness-sync.ts";
import { heartCall, maxHr, recoveryHold } from "./workout-safety.ts";

test("max heart rate follows Tanaka and ignores a missing age", () => {
  assert.equal(maxHr(40), Math.round(208 - 0.7 * 40));
  assert.equal(maxHr(0), Math.round(208 - 0.7 * 34));
});

test("a near-max heart rate asks for a stop but still explains the skip", () => {
  const call = heartCall({ bpm: 190, age: 30 });
  assert.equal(call.level, "stop");
  assert.match(call.reason, /Walk until it drops/);
});

test("zone 5 without hitting the ceiling is a break you can skip", () => {
  const max = maxHr(30);
  const call = heartCall({ bpm: Math.round(max * 0.92), age: 30 });
  assert.equal(call.level, "rest");
});

test("an easy heart rate does not invent a break", () => {
  assert.equal(heartCall({ bpm: 120, age: 30 }).level, "ok");
  assert.equal(heartCall({ bpm: 0, age: 30 }).level, "ok");
});

test("low oxygen is a stop", () => {
  assert.equal(heartCall({ bpm: 110, age: 30, spo2: 90 }).level, "stop");
});

test("blank sleep is not a bad night", () => {
  assert.equal(recoveryHold(null), false);
  assert.equal(recoveryHold({ sleepHours: 0, sleepScore: 0, hrvMs: 0 }), false);
  assert.equal(recoveryHold({ sleepHours: 5.2 }), true);
  assert.equal(recoveryHold({ sleepHours: 7.5, hrvMs: 20 }), true);
  assert.equal(recoveryHold({ sleepHours: 8, sleepScore: 80, hrvMs: 50 }), false);
});

test("a logged night without a heart-rate strap is not treated as a crash", () => {
  const day = blankHealthDay("2026-01-01");
  day.sleepHours = 8;
  assert.equal(recoveryLabel(day), "ok");
  day.sleepHours = 5.1;
  assert.equal(recoveryLabel(day), "low");
  day.sleepHours = 8;
  day.hrvMs = 60;
  assert.equal(recoveryLabel(day), "high");
});
