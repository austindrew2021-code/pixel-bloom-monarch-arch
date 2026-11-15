import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type PlaceHit = { name: string; lat: number; lng: number };

/**
 * Place search for a run or ride. OpenStreetMap, one request when the person
 * asks, not a live watch on the map. No account required.
 */
export const searchPlaces = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ q: z.string().trim().min(2).max(80) }).parse(input))
  .handler(async ({ data }): Promise<PlaceHit[]> => {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", data.q);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "5");
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "SpoonfulKitchen/1.0 (training map; personal meal planner)",
      },
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as { display_name?: string; lat?: string; lon?: string }[];
    return rows
      .map((row) => ({
        name: String(row.display_name ?? "").split(",").slice(0, 2).join(",").trim(),
        lat: Number(row.lat),
        lng: Number(row.lon),
      }))
      .filter((row) => row.name && Number.isFinite(row.lat) && Number.isFinite(row.lng));
  });
