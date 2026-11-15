export type PlaceHit = { name: string; lat: number; lng: number };

type Deps = {
  fetchImpl: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  baseUrl: string;
};

/**
 * OpenStreetMap's Nominatim policy: at most 1 request a second, and cache results.
 *
 * r3, honest scope: the spacing below is enforced PER SERVER INSTANCE, in memory. On serverless
 * hosting (Vercel, Grok) each warm instance has its own queue, so two instances can each send one
 * request in the same second. A truly app-wide limit needs shared storage (a KV or Redis counter),
 * which this app does not have; before a public launch, switch NOMINATIM_URL to an own or commercial
 * geocoder, or add that store. What this file does guarantee per instance:
 *  - requests leave at least PLACE_GAP_MS apart (one at a time, in order);
 *  - at most PLACE_MAX_QUEUED searches wait or run at once; more get [] at once (no upstream call),
 *    so one instance can't build a burst or a long backlog;
 *  - repeat queries are served from a 24 h cache; failures and empty results are not cached.
 */
export const PLACE_GAP_MS = 1100;
export const PLACE_MAX_QUEUED = 3;
export const PLACE_TTL_MS = 24 * 60 * 60 * 1000;
const PLACE_CACHE_MAX = 500;

export function normalizePlaceQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

export function makePlaceSearch(deps: Deps) {
  const cache = new Map<string, { at: number; rows: PlaceHit[] }>();
  let queue: Promise<unknown> = Promise.resolve();
  let lastAt = -Infinity;
  let pending = 0;

  async function fetchOnce(q: string): Promise<PlaceHit[]> {
    const wait = lastAt + PLACE_GAP_MS - deps.now();
    if (wait > 0) await deps.sleep(wait);
    lastAt = deps.now();
    const url = new URL(deps.baseUrl);
    url.searchParams.set("q", q);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "5");
    try {
      const res = await deps.fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "SpoonfulKitchen/1.0 (training map; personal meal planner)",
        },
        signal: AbortSignal.timeout(8000),
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
    } catch {
      return [];
    }
  }

  return async function search(raw: string): Promise<PlaceHit[]> {
    const key = normalizePlaceQuery(raw);
    const hit = cache.get(key);
    if (hit && deps.now() - hit.at < PLACE_TTL_MS) return hit.rows;
    // Server-side burst guard (per instance): beyond the cap, answer empty without calling upstream.
    if (pending >= PLACE_MAX_QUEUED) return [];
    pending++;
    const run = queue.then(() => {
      const again = cache.get(key);
      if (again && deps.now() - again.at < PLACE_TTL_MS) return again.rows;
      return fetchOnce(key).then((rows) => {
        if (rows.length) {
          if (cache.size >= PLACE_CACHE_MAX) cache.delete(cache.keys().next().value as string);
          cache.set(key, { at: deps.now(), rows });
        }
        return rows;
      });
    });
    queue = run.catch(() => undefined);
    return run.finally(() => {
      pending--;
    });
  };
}
