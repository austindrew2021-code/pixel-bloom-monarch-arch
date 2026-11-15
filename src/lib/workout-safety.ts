/**
 * Rest calls from a live heart rate.
 * Max is the Tanaka estimate (208 − 0.7 × age), which is what coaches use when a lab test is not available.
 * This is not a diagnosis. Chest pain, fainting, or confusion means stop, whatever the number says.
 */

export function maxHr(age: number): number {
  const years = Math.min(90, Math.max(16, Math.round(age) || 34));
  return Math.round(208 - 0.7 * years);
}

export type RestLevel = "ok" | "rest" | "stop";

export function heartCall(input: { bpm: number; age: number; spo2?: number }): {
  level: RestLevel;
  zone: number;
  reason: string;
} {
  const max = maxHr(input.age);
  const pct = input.bpm > 0 ? input.bpm / max : 0;
  const zone = pct <= 0 ? 0 : pct < 0.6 ? 1 : pct < 0.7 ? 2 : pct < 0.8 ? 3 : pct < 0.9 ? 4 : 5;
  const spo2 = input.spo2 ?? 0;
  if (spo2 > 0 && spo2 < 92) {
    return {
      level: "stop",
      zone,
      reason: `Oxygen is ${spo2}%. Sit down. Keep going only if that reading looks wrong and you feel fine.`,
    };
  }
  if (input.bpm >= 200 || pct >= 0.96) {
    return {
      level: "stop",
      zone,
      reason: `${input.bpm} bpm is near an estimated max of ${max}. Walk until it drops. Stop if you feel faint, have chest pain, or cannot talk.`,
    };
  }
  if (pct >= 0.9) {
    return {
      level: "rest",
      zone,
      reason: `${input.bpm} bpm is a hard zone. A short walk is the usual break. Skip it if this piece was meant to be hard.`,
    };
  }
  return { level: "ok", zone, reason: "" };
}

export function zoneLabel(zone: number): string {
  return ["No heart rate", "Easy", "Steady", "Tempo", "Hard", "Max"][zone] ?? "No heart rate";
}

/** Missing sleep or HRV is not a bad night. Only a real low reading holds the plan back. */
export function recoveryHold(day?: { sleepHours?: number; sleepScore?: number; hrvMs?: number } | null): boolean {
  if (!day) return false;
  if ((day.sleepHours ?? 0) > 0 && day.sleepHours! < 6) return true;
  if ((day.sleepScore ?? 0) > 0 && day.sleepScore! < 55) return true;
  if ((day.hrvMs ?? 0) > 0 && day.hrvMs! < 25) return true;
  return false;
}
