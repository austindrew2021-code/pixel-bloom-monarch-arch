import { addDays, format, parseISO } from "date-fns";
import type { GoalKind } from "./body.ts";
import { kgFromLb } from "./body.ts";
import { exerciseById } from "./exercises.ts";
import {
  bestEpley,
  logUnit,
  nextWorkingKg,
  previousLine,
  previousSessionForMove,
  warmupLoads,
  warmupReps,
  type LiftSession,
  type SessionFeel,
} from "./lift.ts";

/** Dates before today, newest first. Meal checks skip today because it is not finished. */
export function priorDates(today: string, count: number): string[] {
  const start = parseISO(`${today}T12:00:00`);
  return Array.from({ length: count }, (_, i) => format(addDays(start, -(i + 1)), "yyyy-MM-dd"));
}

/**
 * Protein eaten ÷ protein target across finished days.
 * Null until two days have both a target and some food logged — one light day is not a pattern.
 */
export function proteinAdherence(samples: { eaten: number; target: number }[]): number | null {
  const rows = samples.filter((row) => row.target > 0 && row.eaten > 0);
  if (rows.length < 2) return null;
  const eaten = rows.reduce((sum, row) => sum + row.eaten, 0);
  const target = rows.reduce((sum, row) => sum + row.target, 0);
  if (target <= 0) return null;
  return eaten / target;
}

/** Below three quarters of the protein target, the bar does not go up. */
export function proteinHold(samples: { eaten: number; target: number }[]): boolean {
  const ratio = proteinAdherence(samples);
  return ratio != null && ratio < 0.75;
}

export type RepWindow = { min: number; max: number; timed: boolean };

/**
 * The rep band for a move. A range like "6-8" is used as written.
 * A single number opens a small band so a heavier bar can mean fewer reps.
 * Timed holds ("30-45s") stay timed and are not turned into reps.
 */
export function repWindow(planned: string | undefined, goal: GoalKind): RepWindow {
  const text = planned ?? "";
  const nums = text.match(/\d+/g)?.map(Number).filter((n) => n > 0) ?? [];
  if (/s\b|sec|min/i.test(text)) {
    const min = nums[0] ?? 30;
    const max = nums[1] ?? min;
    return { min: Math.min(min, max), max: Math.max(min, max), timed: true };
  }
  if (!nums.length) {
    if (goal === "performance") return { min: 5, max: 8, timed: false };
    if (goal === "lose") return { min: 6, max: 10, timed: false };
    return { min: 6, max: 12, timed: false };
  }
  let min = nums[0]!;
  let max = nums.length > 1 ? nums[1]! : nums[0]!;
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    const band = goal === "performance" ? 2 : 3;
    min = Math.max(3, min - 1);
    max = max + band;
  }
  return { min, max, timed: false };
}

/** Epley, inverted: reps that this bar implies for a known best. */
export function repsForLoad(weightKg: number, oneRmKg: number, min: number, max: number): number {
  if (!(weightKg > 0) || !(oneRmKg > 0)) return min;
  if (weightKg >= oneRmKg * 0.97) return Math.min(min, 5);
  const raw = 30 * (oneRmKg / weightKg - 1);
  if (!Number.isFinite(raw) || raw < 1) return Math.min(min, 3);
  return Math.min(max, Math.max(min, Math.round(raw)));
}

/** Best logged estimate, or the 1RM implied by the weight they just chose at the bottom of the range. */
export function anchorOneRm(bestKg: number, weightKg: number, reps: number): number {
  if (bestKg > 0) return bestKg;
  if (weightKg > 0 && reps > 0) return weightKg * (1 + reps / 30);
  return 0;
}

function openingKg(moveId: string, bodyKg: number, imperial: boolean): number {
  const ex = exerciseById(moveId);
  if (ex?.bodyweight) return Math.round(bodyKg * 10) / 10;
  const lb = (ex?.compound ?? 2) >= 4 ? 95 : (ex?.compound ?? 2) >= 2 ? 45 : 20;
  return imperial ? kgFromLb(lb) : Math.round(kgFromLb(lb) / 2.5) * 2.5;
}

/**
 * Next working weight. A short protein week blocks an increase.
 * A real stall still deloads — holding a grind because dinner was light is the wrong direction.
 */
export function prescribedWorkingKg(input: {
  sessions: LiftSession[];
  moveId: string;
  feel?: SessionFeel;
  hold: boolean;
  exceptId?: string;
}): number | null {
  const prev = previousLine(input.sessions, input.moveId, input.exceptId);
  const next = nextWorkingKg(input.sessions, input.moveId, prev, input.feel, input.exceptId);
  if (next == null || !input.hold) return next;
  const last = prev?.sets.filter((set) => set.done && !set.warmup).at(-1)?.weightKg ?? 0;
  if (last > 0 && next > last + 0.1) return last;
  return next;
}

export type PrescribedSet = { reps: number; weightKg: number; warmup?: boolean };

/** Working sets, plus warm-up ramps on a barbell. Reps follow the weight and the day's range. */
export function prescribeSets(input: {
  moveId: string;
  sessions: LiftSession[];
  bodyKg: number;
  imperial: boolean;
  goalKind: GoalKind;
  hold: boolean;
  planned?: { sets: number; reps: string };
  exceptId?: string;
}): PrescribedSet[] {
  const prev = previousLine(input.sessions, input.moveId, input.exceptId);
  const feel = previousSessionForMove(input.sessions, input.moveId, input.exceptId)?.feel;
  const plannedKg = prescribedWorkingKg({
    sessions: input.sessions,
    moveId: input.moveId,
    feel,
    hold: input.hold,
    exceptId: input.exceptId,
  });
  const weightKg = plannedKg ?? openingKg(input.moveId, input.bodyKg, input.imperial);
  const window = repWindow(input.planned?.reps, input.goalKind);
  const unit = logUnit(input.moveId);
  const reps =
    unit === "sec"
      ? window.timed
        ? window.min
        : 40
      : unit === "m"
        ? 30
        : repsForLoad(
            weightKg,
            anchorOneRm(bestEpley(input.sessions, input.moveId, input.exceptId), weightKg, window.min),
            window.min,
            window.max,
          );
  const prevCount = prev?.sets.filter((set) => set.done && !set.warmup).length ?? 0;
  const count = Math.max(1, input.planned?.sets ?? (prevCount || 1));
  const working: PrescribedSet[] = Array.from({ length: count }, () => ({ reps, weightKg }));
  const hadWarmup = prev?.sets.some((set) => set.warmup) ?? false;
  const bar = Boolean(exerciseById(input.moveId)?.bar) && !exerciseById(input.moveId)?.bodyweight && unit === "reps";
  if (!bar || !hadWarmup) return working;
  const rampReps = warmupReps(reps);
  const warmups = warmupLoads(weightKg).map((load, i) => ({
    reps: rampReps[i] ?? reps,
    weightKg: load,
    warmup: true as const,
  }));
  return [...warmups, ...working];
}

/** Reps for a weight the person just set. Timed moves are left alone. */
export function repsForChosenWeight(input: {
  moveId: string;
  weightKg: number;
  sessions: LiftSession[];
  goalKind: GoalKind;
  plannedReps?: string;
  exceptId?: string;
}): number | null {
  if (logUnit(input.moveId) !== "reps" || !(input.weightKg > 0)) return null;
  const window = repWindow(input.plannedReps, input.goalKind);
  if (window.timed) return null;
  const best = bestEpley(input.sessions, input.moveId, input.exceptId);
  return repsForLoad(input.weightKg, anchorOneRm(best, input.weightKg, window.min), window.min, window.max);
}

const CARDIO_GROW: Record<GoalKind, { step: number; cap: number; floor: number }> = {
  lose: { step: 5, cap: 1.2, floor: 0.7 },
  recomp: { step: 5, cap: 1.3, floor: 0.75 },
  maintain: { step: 5, cap: 1.25, floor: 0.75 },
  lean: { step: 5, cap: 1.4, floor: 0.8 },
  performance: { step: 8, cap: 1.5, floor: 0.8 },
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export type CardioRx = { minutes: number; distanceKm?: number; note: string };

/**
 * Time from the plan, nudged by what they have actually finished.
 * Distance only appears once a pace exists — it is that pace times the new time, not a guess.
 */
export function prescribeCardio(input: {
  planMinutes: number;
  kind: "run" | "ride" | "walk" | "rest";
  goalKind: GoalKind;
  recent: { minutes: number; distanceKm?: number }[];
  /** Short sleep, low sleep score, or very low HRV. The day gets shorter instead of longer. */
  ease?: boolean;
}): CardioRx {
  if (input.kind === "rest" || input.planMinutes <= 0) {
    return { minutes: 0, note: "Nothing scheduled. Log a short one only if you want it." };
  }
  const done = input.recent.filter((row) => row.minutes >= 5).slice(0, 6);
  if (!done.length) {
    const minutes = input.ease ? Math.max(15, Math.round(input.planMinutes * 0.75)) : input.planMinutes;
    return {
      minutes,
      note: input.ease
        ? "Short sleep or low recovery, so the time is shorter. Distance waits until you have a pace."
        : "Time is set from your goal. Distance shows up after a logged effort, at your pace.",
    };
  }
  const spec = CARDIO_GROW[input.goalKind] ?? CARDIO_GROW.maintain;
  const typical = median(done.map((row) => row.minutes));
  const last = done[0]!;
  const cap = Math.max(input.planMinutes, Math.round(input.planMinutes * spec.cap));
  const floor = Math.max(15, Math.round(input.planMinutes * spec.floor));
  let minutes = Math.round(typical);
  if (input.ease) minutes = Math.max(floor, Math.round(minutes * 0.85));
  else if (last.minutes < typical * 0.7) minutes = Math.max(floor, minutes - spec.step);
  else if (last.minutes >= input.planMinutes * 0.85) minutes = Math.min(cap, minutes + spec.step);
  minutes = Math.min(cap, Math.max(floor, minutes));

  const paced = done.filter((row) => (row.distanceKm ?? 0) > 0);
  const lead = input.ease ? "Short sleep or low recovery, so this stays easier. " : "";
  if (!paced.length) {
    return { minutes, note: `${lead}${minutes} min, from your last ${done.length}. Add a distance once and pace takes over.` };
  }
  const pace = median(paced.map((row) => row.minutes / row.distanceKm!));
  if (!(pace > 0)) return { minutes, note: `${lead}${minutes} min, from your last ${done.length}.` };
  const distanceKm = Math.round((minutes / pace) * 10) / 10;
  return {
    minutes,
    distanceKm,
    note: `${lead}${minutes} min · ${distanceKm} km at your recent pace. Change the distance if today is different.`,
  };
}

/** Same minutes the log will store, so a short clock does not keep a full target distance. */
export function scaleTargetDistance(targetKm: number, targetMinutes: number, actualMinutes: number): number {
  if (!(targetKm > 0) || !(targetMinutes > 0)) return 0;
  const scale = Math.min(1.5, Math.max(0, actualMinutes) / targetMinutes);
  return Math.round(targetKm * scale * 100) / 100;
}
