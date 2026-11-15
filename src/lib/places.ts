import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { makePlaceSearch, type PlaceAnswer, type PlaceHit } from "./places-core";

export type { PlaceAnswer, PlaceHit };

// One shared, throttled, cached client on the server. NOMINATIM_URL lets us switch
// providers without an app update (OpenStreetMap policy asks for that).
const placeSearch = makePlaceSearch({
  fetchImpl: (...args) => fetch(...args),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  baseUrl: process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org/search",
});

/**
 * Place search for a run or ride. OpenStreetMap, one request when the person
 * submits (never per keystroke), at most one a second app-wide, cached.
 */
export const searchPlaces = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ q: z.string().trim().min(2).max(80) }).parse(input))
  // k2: { hits, busy } so a full queue reads as "busy", not as "no place matched".
  .handler(async ({ data }): Promise<PlaceAnswer> => placeSearch.lookup(data.q));
