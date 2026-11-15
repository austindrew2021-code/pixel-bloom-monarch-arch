import { getISODay, parseISO } from "date-fns";
import type { RideEffort } from "./types";

/** Which training home the person is in. Each one is a different product, on purpose. */
export type TrainFocus = "weights" | "run" | "ride" | "home";

export const TRAIN_FOCI: { id: TrainFocus; label: string; line: string }[] = [
  {
    id: "weights",
    label: "Weights",
    line: "A gym plan, then a fast log. Last weight stays on the set. Recovery is only from sets you actually logged.",
  },
  {
    id: "run",
    label: "Run",
    line: "Distance, time, and pace for the week. The map is this phone’s GPS. A short night keeps the day easier.",
  },
  {
    id: "ride",
    label: "Ride",
    line: "Time and speed for the week, with a GPS line on the phone. No segments, no leaderboard.",
  },
  {
    id: "home",
    label: "At home",
    line: "Pick a length and follow the timer. The picture is the real move. It is not a studio class.",
  },
];

export function normalizeTrainFocus(value: unknown): TrainFocus {
  return value === "run" || value === "ride" || value === "home" ? value : "weights";
}

export type EnduranceDay = {
  name: string;
  minutes: number;
  kind: "run" | "ride" | "walk" | "rest";
  note: string;
};

const RUN_WEEK: EnduranceDay[] = [
  { name: "Easy run", minutes: 30, kind: "run", note: "Conversational. You could talk the whole way." },
  { name: "Rest or walk", minutes: 20, kind: "walk", note: "Off the harder days. A walk still counts." },
  { name: "Steady run", minutes: 35, kind: "run", note: "A little quicker than easy. Still in control." },
  { name: "Easy run", minutes: 25, kind: "run", note: "Short. Do not turn it into a test." },
  { name: "Rest", minutes: 0, kind: "rest", note: "Nothing scheduled. Log a walk only if you want." },
  { name: "Long run", minutes: 50, kind: "run", note: "Slower than you think. The point is time on your feet." },
  { name: "Shakeout", minutes: 20, kind: "walk", note: "Easy walk, or skip it." },
];

const RIDE_WEEK: EnduranceDay[] = [
  { name: "Easy spin", minutes: 40, kind: "ride", note: "Light gear. You should finish fresher than you started." },
  { name: "Rest", minutes: 0, kind: "rest", note: "A day off the bike." },
  { name: "Steady ride", minutes: 45, kind: "ride", note: "Sit a bit harder for the middle. No sprints required." },
  { name: "Easy spin", minutes: 30, kind: "ride", note: "Short. Keep it smooth." },
  { name: "Rest", minutes: 0, kind: "rest", note: "Nothing scheduled." },
  { name: "Long ride", minutes: 75, kind: "ride", note: "The long one. Eat before you go." },
  { name: "Easy spin", minutes: 30, kind: "ride", note: "Spin the legs out, or skip it." },
];

export function weekdayIndex(date: string): number {
  return getISODay(parseISO(`${date}T12:00:00`)) - 1;
}

export function enduranceDay(focus: "run" | "ride", date: string): EnduranceDay {
  const plan = focus === "run" ? RUN_WEEK : RIDE_WEEK;
  return plan[weekdayIndex(date)] ?? plan[0]!;
}

export function enduranceWeek(focus: "run" | "ride"): EnduranceDay[] {
  return focus === "run" ? RUN_WEEK : RIDE_WEEK;
}

const KM_PER_MI = 1.60934;

export function kmToShown(km: number, imperial: boolean): number {
  return imperial ? km / KM_PER_MI : km;
}

export function shownToKm(shown: number, imperial: boolean): number {
  return imperial ? shown * KM_PER_MI : shown;
}

export function distanceUnit(imperial: boolean): "mi" | "km" {
  return imperial ? "mi" : "km";
}

/** Pace for a run or walk, speed for a ride. Null when distance was not logged. */
export function activityPace(
  distanceKm: number,
  minutes: number,
  imperial: boolean,
  kind: "run" | "ride" | "walk",
): string | null {
  if (!(distanceKm > 0) || !(minutes > 0)) return null;
  const shown = kmToShown(distanceKm, imperial);
  if (!(shown > 0)) return null;
  if (kind === "ride") {
    const perHour = shown / (minutes / 60);
    return `${perHour.toFixed(1)} ${imperial ? "mph" : "km/h"}`;
  }
  const totalSec = Math.round((minutes / shown) * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")} / ${distanceUnit(imperial)}`;
}

export function formatDistance(km: number, imperial: boolean): string {
  const n = kmToShown(km, imperial);
  const digits = n >= 10 ? 1 : 2;
  return `${n.toFixed(digits)} ${distanceUnit(imperial)}`;
}

export function formatClock(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const RIDE_EFFORTS: { id: RideEffort; label: string }[] = [
  { id: "easy", label: "Easy" },
  { id: "steady", label: "Steady" },
  { id: "tempo", label: "Tempo" },
  { id: "climb", label: "Climb" },
  { id: "sprint", label: "Sprint" },
];

export function sumKm(workouts: { date: string; distanceKm?: number }[], dates: string[]): number {
  return workouts.filter((w) => dates.includes(w.date)).reduce((sum, w) => sum + (w.distanceKm ?? 0), 0);
}
