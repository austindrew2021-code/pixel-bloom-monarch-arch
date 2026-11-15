import { compassLabel, destinationPoint, type GeoPoint } from "./geo-track.ts";

/** Six loops around the person, so every side of town gets a choice. */
export const LOOP_BEARINGS = [0, 60, 120, 180, 240, 300];

/**
 * Two corners of a loop. The radius is tuned so a street route lands near
 * the distance they asked for, not a straight line on a highway.
 */
export function loopVias(start: GeoPoint, bearing: number, km: number): [GeoPoint, GeoPoint] {
  const radius = (Math.max(1, km) * 1000) / 5.6;
  return [destinationPoint(start, bearing, radius), destinationPoint(start, bearing + 110, radius * 0.85)];
}

export function routeTitle(streets: string[], bearing: number): string {
  const dir = compassLabel(bearing);
  const way = dir.slice(0, 1).toUpperCase() + dir.slice(1);
  const street = streets.find((name) => name.trim().length > 2 && !/unnamed/i.test(name));
  return street ? `${way} · ${street.trim()}` : `${way} loop`;
}

export function distanceChoices(
  sport: "run" | "ride",
  imperial: boolean,
): { label: string; km: number }[] {
  if (imperial) {
    return sport === "ride"
      ? [
          { label: "3 miles", km: 4.83 },
          { label: "10 miles", km: 16.09 },
          { label: "20 miles", km: 32.19 },
        ]
      : [
          { label: "1 mile", km: 1.61 },
          { label: "3 miles", km: 4.83 },
          { label: "6 miles", km: 9.66 },
        ];
  }
  const kms = sport === "ride" ? [5, 15, 30] : [2, 5, 10];
  return kms.map((km) => ({ label: `${km} km`, km }));
}

export function closestChoice<T extends { km: number }>(choices: T[], targetKm?: number): T {
  const mid = choices[Math.min(1, choices.length - 1)] ?? choices[0]!;
  if (!(targetKm && targetKm > 0)) return mid;
  return choices.reduce((best, item) => (Math.abs(item.km - targetKm) < Math.abs(best.km - targetKm) ? item : best));
}
