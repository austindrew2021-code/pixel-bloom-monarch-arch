import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { haversine, simplifyRoute, type GeoPoint } from "./geo-track.ts";
import { LOOP_BEARINGS, loopVias, routeTitle } from "./route-ideas.ts";

export type RouteIdea = {
  id: string;
  name: string;
  km: number;
  minutes: number;
  points: GeoPoint[];
};

const cache = new Map<string, { at: number; rows: RouteIdea[] }>();

/**
 * Real street loops from OpenStreetMap routing.
 * A ride uses the bike profile (cycleways and streets bikes may use).
 * A run uses the foot profile (paths and quieter streets, not highways).
 * Each loop is asked to return to the start. Nothing is drawn if the router has no way.
 */
export const suggestLoops = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        lat: z.number().gte(-90).lte(90),
        lng: z.number().gte(-180).lte(180),
        km: z.number().gt(0.5).lte(45),
        sport: z.enum(["run", "ride"]),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<RouteIdea[]> => {
    const key = `${data.sport}|${data.km}|${data.lat.toFixed(2)}|${data.lng.toFixed(2)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.rows;
    const start = { lat: data.lat, lng: data.lng };
    const found: RouteIdea[] = [];
    for (let i = 0; i < LOOP_BEARINGS.length; i += 3) {
      const batch = LOOP_BEARINGS.slice(i, i + 3);
      const rows = await Promise.all(batch.map((bearing) => oneLoop(start, bearing, data.km, data.sport)));
      for (const row of rows) if (row) found.push(row);
    }
    const near = found.filter((row) => row.km > data.km * 0.45 && row.km < data.km * 1.9);
    const pool = (near.length >= 2 ? near : found).sort((a, b) => Math.abs(a.km - data.km) - Math.abs(b.km - data.km));
    const rows: RouteIdea[] = [];
    for (const row of pool) {
      if (rows.some((kept) => kept.name === row.name)) continue;
      rows.push(row);
      if (rows.length >= 6) break;
    }
    cache.set(key, { at: Date.now(), rows });
    return rows;
  });

async function oneLoop(start: GeoPoint, bearing: number, km: number, sport: "run" | "ride"): Promise<RouteIdea | null> {
  const [a, b] = loopVias(start, bearing, km);
  const bike = sport === "ride";
  const host = bike
    ? "https://routing.openstreetmap.de/routed-bike/route/v1/bike/"
    : "https://routing.openstreetmap.de/routed-foot/route/v1/foot/";
  const coords = [start, a, b, start].map((point) => `${point.lng.toFixed(5)},${point.lat.toFixed(5)}`).join(";");
  try {
    const res = await fetch(`${host}${coords}?overview=full&geometries=geojson&steps=true`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "SpoonfulKitchen/1.0 (training loops; personal meal planner)",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      code?: string;
      routes?: {
        distance?: number;
        duration?: number;
        geometry?: { coordinates?: [number, number][] };
        legs?: { steps?: { name?: string }[] }[];
      }[];
    };
    const route = body.code === "Ok" ? body.routes?.[0] : undefined;
    if (!route?.geometry?.coordinates || route.geometry.coordinates.length < 4) return null;
    const points = route.geometry.coordinates
      .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
      .map(([lng, lat]) => ({ lat, lng }));
    if (points.length < 4) return null;
    const back = haversine(points.at(-1)!, start);
    if (back > 700) return null;
    const distanceKm = Math.round(((route.distance ?? 0) / 1000) * 10) / 10;
    if (distanceKm < 0.8) return null;
    const streets: string[] = [];
    for (const leg of route.legs ?? []) {
      for (const step of leg.steps ?? []) {
        const name = (step.name ?? "").trim();
        if (name && !streets.includes(name)) streets.push(name);
      }
    }
    const minutes = bike ? Math.max(8, Math.round((route.duration ?? 0) / 60)) : Math.max(10, Math.round(distanceKm * 7));
    return {
      id: `${bearing}-${distanceKm}`,
      name: routeTitle(streets, bearing),
      km: distanceKm,
      minutes,
      points: simplifyRoute(points, 70),
    };
  } catch {
    return null;
  }
}
