import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";
import {
  fitZoom,
  metersPerPixel,
  tileToWorld,
  worldToTile,
  type GeoPoint,
} from "@/lib/geo-track";
import { closestChoice, distanceChoices } from "@/lib/route-ideas";
import { suggestLoops, type RouteIdea } from "@/lib/route-suggest";
import { searchPlaces, type PlaceHit } from "@/lib/places";
import { cn } from "@/lib/utils";

const TILE = 256;

export function RouteMap({
  points,
  destination,
  onDestination,
  heading,
  accuracyM,
  imperial,
  topInset = 0,
  sport,
  targetKm,
}: {
  points: GeoPoint[];
  destination: GeoPoint | null;
  onDestination: (point: GeoPoint | null) => void;
  heading?: number | null;
  accuracyM?: number;
  imperial?: boolean;
  /** Pixels to keep clear at the top for the clock overlay. */
  topInset?: number;
  sport: "run" | "ride";
  targetKm?: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(15);
  const [look, setLook] = useState<GeoPoint | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchBusy = useRef(false);
  const [finding, setFinding] = useState(false);
  const choices = useMemo(() => distanceChoices(sport, Boolean(imperial)), [sport, imperial]);
  const [choiceKm, setChoiceKm] = useState(() => closestChoice(distanceChoices(sport, Boolean(imperial)), targetKm).km);
  const [ideas, setIdeas] = useState<RouteIdea[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const requestKey = useRef("");
  const fitted = useRef("");
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const here = points.at(-1) ?? null;
  const start = points[0] ?? null;
  const camera = useMemo(() => {
    if (look) return look;
    if (!here) return destination;
    if (heading == null || !Number.isFinite(heading)) return here;
    const ahead = Math.min(220, size.h * 0.28);
    const tile = worldToTile(here.lat, here.lng, zoom);
    const rad = (heading * Math.PI) / 180;
    return tileToWorld(tile.x + (Math.sin(rad) * ahead) / TILE, tile.y - (Math.cos(rad) * ahead) / TILE, zoom);
  }, [look, here, destination, heading, size.h, zoom]);
  const centerRef = useRef<GeoPoint | null>(camera);
  centerRef.current = camera;

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!here) return;
    const key = `${sport}|${choiceKm}|${here.lat.toFixed(2)}|${here.lng.toFixed(2)}`;
    if (requestKey.current === key) return;
    requestKey.current = key;
    setLoadingRoutes(true);
    void suggestLoops({ data: { lat: here.lat, lng: here.lng, km: choiceKm, sport } })
      .then((rows) => {
        if (requestKey.current !== key) return;
        setIdeas(rows);
        setPicked(rows[0]?.id ?? null);
        setLoadingRoutes(false);
      })
      .catch(() => {
        if (requestKey.current !== key) return;
        setIdeas([]);
        setPicked(null);
        setLoadingRoutes(false);
      });
  }, [here, choiceKm, sport]);

  useEffect(() => {
    const stamp = ideas.map((idea) => idea.id).join("|");
    if (!stamp || size.w < 40 || fitted.current === stamp) return;
    fitted.current = stamp;
    const view = fitZoom(
      ideas.flatMap((idea) => idea.points),
      size.w,
      size.h,
    );
    setZoom(view.zoom);
    setLook(view.center);
  }, [ideas, size.w, size.h]);

  const tiles = useMemo(() => {
    if (!camera || size.w < 20 || size.h < 20) return [];
    const c = worldToTile(camera.lat, camera.lng, zoom);
    const n = 2 ** zoom;
    const halfX = Math.ceil(size.w / 2 / TILE) + 1;
    const halfY = Math.ceil(size.h / 2 / TILE) + 1;
    const tx0 = Math.floor(c.x);
    const ty0 = Math.floor(c.y);
    const out: { key: string; src: string; left: number; top: number }[] = [];
    for (let tx = tx0 - halfX; tx <= tx0 + halfX; tx += 1) {
      for (let ty = ty0 - halfY; ty <= ty0 + halfY; ty += 1) {
        if (ty < 0 || ty >= n) continue;
        const wrapped = ((tx % n) + n) % n;
        out.push({
          key: `${zoom}-${wrapped}-${ty}`,
          src: `https://tile.openstreetmap.org/${zoom}/${wrapped}/${ty}.png`,
          left: (tx - c.x) * TILE + size.w / 2,
          top: (ty - c.y) * TILE + size.h / 2,
        });
      }
    }
    return out;
  }, [camera, zoom, size.w, size.h]);

  function toPx(point: GeoPoint): { x: number; y: number } | null {
    if (!camera || size.w < 20) return null;
    const t = worldToTile(point.lat, point.lng, zoom);
    const c = worldToTile(camera.lat, camera.lng, zoom);
    return { x: (t.x - c.x) * TILE + size.w / 2, y: (t.y - c.y) * TILE + size.h / 2 };
  }

  function toLine(pts: GeoPoint[]): string {
    return pts
      .map((point) => {
        const px = toPx(point);
        return px ? `${px.x},${px.y}` : "";
      })
      .filter(Boolean)
      .join(" ");
  }

  const line = toLine(points);
  const herePx = here ? toPx(here) : null;
  const startPx = start && points.length > 1 ? toPx(start) : null;
  const destPx = destination ? toPx(destination) : null;
  const accuracyPx =
    here && accuracyM && accuracyM > 0 && accuracyM < 80 ? accuracyM / metersPerPixel(here.lat, zoom) : 0;
  const scale = camera ? scaleBar(camera.lat, zoom, Boolean(imperial)) : null;

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, moved: false };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = drag.current;
    const origin = centerRef.current;
    if (!state || !origin) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.moved && Math.hypot(dx, dy) < 8) return;
    state.moved = true;
    state.x = event.clientX;
    state.y = event.clientY;
    const c = worldToTile(origin.lat, origin.lng, zoom);
    const next = tileToWorld(c.x - dx / TILE, c.y - dy / TILE, zoom);
    centerRef.current = next;
    setLook(next);
  }

  function onPointerUp() {
    drag.current = null;
  }

  function showIdea(idea: RouteIdea) {
    setPicked(idea.id);
    if (size.w < 40) return;
    const view = fitZoom(idea.points, size.w, size.h);
    setZoom(view.zoom);
    setLook(view.center);
  }

  function follow() {
    setLook(null);
    setZoom(15);
  }

  function showAll() {
    const pts = [...points, ...ideas.flatMap((idea) => idea.points)];
    if (destination) pts.push(destination);
    if (pts.length < 2 || size.w < 40) return;
    const view = fitZoom(pts, size.w, size.h);
    setZoom(view.zoom);
    setLook(view.center);
  }

  async function search() {
    // r3: one search at a time. The ref blocks a second Enter before the "searching" state renders.
    if (query.trim().length < 2 || searching || searchBusy.current) return;
    searchBusy.current = true;
    setSearching(true);
    try {
      const rows = await searchPlaces({ data: { q: query.trim() } });
      setHits(rows);
      if (!rows.length) toast("No place matched that. Drag the map, or tap it.");
    } catch {
      toast("Place search did not answer. Drag the map, or tap it.");
    } finally {
      searchBusy.current = false;
      setSearching(false);
    }
  }

  return (
    <div ref={boxRef} className="relative h-full w-full overflow-hidden bg-[#d5d0c4]">
      <div
        className="absolute inset-0 touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="application"
        aria-label="Live map. Drag to look around. Pick a distance, then a route."
      >
        {tiles.map((tile) => (
          <img
            key={tile.key}
            alt=""
            width={TILE}
            height={TILE}
            draggable={false}
            className="absolute max-w-none select-none"
            style={{ left: tile.left, top: tile.top }}
            src={tile.src}
            onError={(event) => {
              event.currentTarget.style.visibility = "hidden";
            }}
          />
        ))}
        {line || herePx || destPx ? (
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            {herePx && accuracyPx > 8 ? (
              <circle cx={herePx.x} cy={herePx.y} r={Math.min(120, accuracyPx)} fill="rgb(61 126 255 / 0.18)" />
            ) : null}
            {herePx && destPx ? (
              <line
                x1={herePx.x}
                y1={herePx.y}
                x2={destPx.x}
                y2={destPx.y}
                stroke="white"
                strokeWidth="6"
                strokeDasharray="2 10"
                strokeLinecap="round"
              />
            ) : null}
            {herePx && destPx ? (
              <line
                x1={herePx.x}
                y1={herePx.y}
                x2={destPx.x}
                y2={destPx.y}
                stroke="#1c1a16"
                strokeWidth="2"
                strokeDasharray="2 10"
                strokeLinecap="round"
              />
            ) : null}
            {ideas.map((idea) => {
              const planned = toLine(idea.points);
              if (!planned) return null;
              const on = idea.id === picked;
              return (
                <g key={idea.id}>
                  <polyline
                    points={planned}
                    fill="none"
                    stroke="white"
                    strokeWidth={on ? 10 : 6}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  <polyline
                    points={planned}
                    fill="none"
                    stroke={on ? "var(--color-spark)" : "#3f5c4a"}
                    strokeWidth={on ? 6 : 3}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </g>
              );
            })}
            {line ? (
              <polyline
                points={line}
                fill="none"
                stroke="white"
                strokeWidth="7"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
            {line ? (
              <polyline
                points={line}
                fill="none"
                stroke="#2563eb"
                strokeWidth="4"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
          </svg>
        ) : null}
        {startPx ? (
          <span
            className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background ring-2 ring-foreground"
            style={{ left: startPx.x, top: startPx.y }}
          />
        ) : null}
        {destPx ? (
          <span
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-full"
            style={{ left: destPx.x, top: destPx.y }}
          >
            <svg width="22" height="30" viewBox="0 0 22 30" aria-hidden>
              <path d="M11 29C11 29 21 17.2 21 11a10 10 0 1 0-20 0c0 6.2 10 18 10 18z" fill="#1c1a16" />
              <circle cx="11" cy="11" r="4" fill="white" />
            </svg>
          </span>
        ) : null}
        {herePx ? (
          <span
            className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2"
            style={{
              left: herePx.x,
              top: herePx.y,
              transform: `translate(-50%, -50%) rotate(${heading ?? 0}deg)`,
            }}
          >
            <span className="absolute inset-0 rounded-full bg-primary ring-2 ring-background" />
            {heading != null ? (
              <span className="absolute left-1/2 top-0 h-2 w-0 -translate-x-1/2 -translate-y-1 border-x-[5px] border-b-[8px] border-x-transparent border-b-primary" />
            ) : null}
          </span>
        ) : null}
        {!camera ? (
          <p className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-foreground">
            Waiting for this phone’s location. The line is only drawn from GPS.
          </p>
        ) : null}
      </div>

      <div className="absolute right-2 z-10 flex flex-col gap-1.5" style={{ top: Math.max(12, topInset) }}>
        <MapButton label="Zoom in" onClick={() => setZoom((z) => Math.min(18, z + 1))}>
          +
        </MapButton>
        <MapButton label="Zoom out" onClick={() => setZoom((z) => Math.max(12, z - 1))}>
          −
        </MapButton>
        <MapButton label={look ? "Follow my location" : "Following"} onClick={follow}>
          {look ? "Me" : "On"}
        </MapButton>
        <MapButton label="Show every route" onClick={showAll} disabled={points.length < 2 && ideas.length < 1}>
          All
        </MapButton>
      </div>

      {scale ? (
        <div className="pointer-events-none absolute left-3 z-10" style={{ top: Math.max(12, topInset) }}>
          <div className="h-1.5 rounded-sm bg-foreground" style={{ width: scale.px }} />
          <p className="mt-0.5 text-[10px] font-semibold text-foreground">{scale.label}</p>
        </div>
      ) : null}
      <div className="absolute inset-x-2 bottom-2 z-10 flex flex-col gap-2">
        <p className="rounded-2xl bg-background/95 px-3 py-2 text-sm leading-snug shadow-[var(--shadow-border)]">
          {sport === "ride"
            ? "Bike paths and streets bikes may use. Every loop comes back here."
            : "Paths and quieter streets. Every loop comes back here."}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {choices.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => setChoiceKm(item.km)}
              className={cn(
                "h-12 rounded-2xl text-base font-semibold",
                item.km === choiceKm ? "bg-primary text-primary-foreground" : "bg-background/95",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        {loadingRoutes ? <p className="rounded-2xl bg-background/95 px-3 py-3 text-base">Finding safe routes…</p> : null}
        {!loadingRoutes && here && ideas.length === 0 ? (
          <p className="rounded-2xl bg-background/95 px-3 py-3 text-sm leading-snug">
            No loop of that length nearby. Try another distance. You can still go, and the map will follow you.
          </p>
        ) : null}
        {ideas.length ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {ideas.map((idea) => {
              const on = idea.id === picked;
              const dist = imperial ? `${(idea.km * 0.621371).toFixed(1)} mi` : `${idea.km.toFixed(1)} km`;
              return (
                <button
                  key={idea.id}
                  type="button"
                  onClick={() => showIdea(idea)}
                  className={cn(
                    "h-[4.75rem] w-44 shrink-0 rounded-2xl px-3 text-left",
                    on ? "bg-primary text-primary-foreground" : "bg-background/95",
                  )}
                >
                  <span className="block truncate text-base font-semibold leading-tight">{idea.name}</span>
                  <span className={cn("mt-1 block text-sm", on ? "text-primary-foreground/90" : "text-muted-foreground")}>
                    {dist} · about {idea.minutes} min
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        {finding ? (
          <div className="flex gap-1.5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Park, street, café"
              className="h-12 min-w-0 flex-1 rounded-xl bg-background/95 px-3 text-base shadow-[var(--shadow-border)]"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !searching) void search();
              }}
            />
            <button
              type="button"
              className="h-12 rounded-xl bg-background/95 px-3 text-base font-semibold shadow-[var(--shadow-border)]"
              onClick={() => void search()}
              disabled={searching}
            >
              {searching ? "…" : "Find"}
            </button>
          </div>
        ) : (
          <button type="button" className="h-11 text-left text-base font-semibold" onClick={() => setFinding(true)}>
            Find a place
          </button>
        )}
        {hits.length ? (
          <ul className="max-h-32 overflow-auto rounded-xl bg-background/95 shadow-[var(--shadow-border)]">
            {hits.map((hit) => (
              <li key={`${hit.lat}-${hit.lng}`}>
                <button
                  type="button"
                  className="block w-full truncate px-3 py-3 text-left text-base"
                  onClick={() => {
                    onDestination({ lat: hit.lat, lng: hit.lng });
                    if (here && size.w > 40) {
                      const view = fitZoom([here, { lat: hit.lat, lng: hit.lng }], size.w, size.h);
                      setZoom(view.zoom);
                      setLook(view.center);
                    } else {
                      setLook({ lat: hit.lat, lng: hit.lng });
                    }
                    setHits([]);
                    setQuery(hit.name);
                  }}
                >
                  {hit.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-[10px] text-foreground/80">© OpenStreetMap contributors</p>
      </div>
    </div>
  );
}

function MapButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="h-12 w-12 rounded-full bg-background/95 text-lg font-semibold shadow-[var(--shadow-border)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function scaleBar(lat: number, zoom: number, imperial: boolean): { px: number; label: string } {
  const mpp = metersPerPixel(lat, zoom);
  const raw = mpp * 96;
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const n = raw / pow;
  const nice = (n >= 5 ? 5 : n >= 2 ? 2 : 1) * pow;
  const px = Math.max(36, Math.min(140, nice / mpp));
  if (imperial && nice >= 160) {
    const miles = nice / 1609.344;
    return { px, label: miles >= 1 ? `${miles.toFixed(miles >= 10 ? 0 : 1)} mi` : `${Math.round(miles * 10) / 10} mi` };
  }
  if (nice >= 1000) return { px, label: `${(nice / 1000).toFixed(nice >= 10000 ? 0 : 1)} km` };
  return { px, label: `${Math.round(nice)} m` };
}

/** A saved line, not a live map. Used on the activity row and the watch face. */
export function RouteSpark({ points }: { points: GeoPoint[] }) {
  if (points.length < 2) return null;
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const dx = maxLng - minLng || 0.0001;
  const dy = maxLat - minLat || 0.0001;
  const line = points
    .map((point) => `${((point.lng - minLng) / dx) * 52 + 2},${(1 - (point.lat - minLat) / dy) * 28 + 2}`)
    .join(" ");
  return (
    <svg viewBox="0 0 56 32" className="h-8 w-14 shrink-0 text-spark" aria-hidden>
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
