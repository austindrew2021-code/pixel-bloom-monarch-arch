import { useEffect, useRef, useState } from "react";
import { useHeartSession, HeartRow, HeartWarn } from "@/components/live-signals";
import { RouteMap } from "@/components/route-map";
import { haversine, pathMeters, simplifyRoute, type GeoPoint } from "@/lib/geo-track";
import { scaleTargetDistance } from "@/lib/prescribe";
import { useSpoonful } from "@/lib/spoonful-store";
import {
  activityPace,
  distanceUnit,
  formatClock,
  kmToShown,
  RIDE_EFFORTS,
  shownToKm,
} from "@/lib/train-focus";
import type { RideEffort } from "@/lib/types";
import { isoDate } from "@/lib/fuel";
import { cn } from "@/lib/utils";

export function TrainRecord({
  sport,
  title,
  note,
  imperial,
  targetMinutes,
  targetKm,
  onClose,
  onSave,
}: {
  sport: "run" | "ride";
  title: string;
  note: string;
  imperial: boolean;
  targetMinutes?: number;
  targetKm?: number;
  onClose: () => void;
  onSave: (result: {
    minutes: number;
    distanceKm?: number;
    effort?: RideEffort;
    climbM?: number;
    route?: GeoPoint[];
    avgHr?: number;
  }) => void;
}) {
  const age = useSpoonful((s) => s.body.age);
  const spo2 = useSpoonful((s) => s.healthByDate[isoDate()]?.spo2 ?? 0);
  const heart = useHeartSession(age, spo2);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [distance, setDistance] = useState(() => (targetKm && targetKm > 0 ? shownDistance(targetKm, imperial) : ""));
  const [distanceTouched, setDistanceTouched] = useState(false);
  const [climb, setClimb] = useState("");
  const [effort, setEffort] = useState<RideEffort | null>(null);
  const [laps, setLaps] = useState<{ sec: number; km: number }[]>([]);
  const [points, setPoints] = useState<GeoPoint[]>([]);
  const [destination, setDestination] = useState<GeoPoint | null>(null);
  const [gpsNote, setGpsNote] = useState("");
  const [heading, setHeading] = useState<number | null>(null);
  const [accuracyM, setAccuracyM] = useState(0);
  const pointsRef = useRef<GeoPoint[]>([]);
  const pausedRef = useRef(false);
  const elapsedRef = useRef(0);
  const splitKm = useRef(0);
  const climbRef = useRef(0);
  const lastAlt = useRef<number | null>(null);
  const unit = distanceUnit(imperial);
  const shown = Number(distance);
  const km = Number.isFinite(shown) && shown > 0 ? shownToKm(shown, imperial) : 0;
  const pace = elapsed >= 10 && km > 0 ? activityPace(km, elapsed / 60, imperial, sport) : null;
  const climbM = Number(climb);
  const gpsKm = pathMeters(points) / 1000;
  pausedRef.current = paused;
  elapsedRef.current = elapsed;

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [paused]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsNote("This phone has no location. Distance stays what you type.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        if (pausedRef.current) return;
        if (pos.coords.accuracy > 80) return;
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (pos.coords.heading != null && Number.isFinite(pos.coords.heading)) setHeading(pos.coords.heading);
        if (Number.isFinite(pos.coords.accuracy)) setAccuracyM(pos.coords.accuracy);
        const alt = pos.coords.altitude;
        if (alt != null && Number.isFinite(alt)) {
          if (lastAlt.current != null) {
            const gain = alt - lastAlt.current;
            if (gain > 1 && gain < 30) climbRef.current += gain;
          }
          lastAlt.current = alt;
        }
        setPoints((prev) => {
          const last = prev.at(-1);
          if (last && haversine(last, next) < 3) return prev;
          const list = [...prev, next];
          pointsRef.current = list;
          return list;
        });
        setGpsNote("");
      },
      () => setGpsNote("Location is off. Distance stays what you type."),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  useEffect(() => {
    if (distanceTouched) return;
    if (gpsKm < 0.02) return;
    setDistance(shownDistance(gpsKm, imperial));
  }, [gpsKm, distanceTouched, imperial]);

  useEffect(() => {
    const whole = Math.floor(gpsKm);
    if (whole >= 1 && whole > splitKm.current) {
      setLaps((list) => [...list, { sec: elapsedRef.current, km: gpsKm }]);
      splitKm.current = whole;
    }
  }, [gpsKm]);

  function finish() {
    const minutes = Math.max(5, Math.round(elapsed / 60) || 1);
    const tracked = pathMeters(pointsRef.current) / 1000;
    const typed = km > 0 ? Math.round(km * 100) / 100 : 0;
    let distanceKm: number | undefined;
    if (!distanceTouched && tracked > 0.05) distanceKm = Math.round(tracked * 100) / 100;
    else if (!distanceTouched && targetKm && targetMinutes) {
      const scaled = scaleTargetDistance(targetKm, targetMinutes, minutes);
      distanceKm = scaled > 0.05 ? scaled : typed > 0 ? typed : undefined;
    } else if (typed > 0) distanceKm = typed;
    const route = simplifyRoute(pointsRef.current);
    const typedClimb = Number.isFinite(climbM) && climbM > 0 ? Math.round(climbM) : 0;
    const gpsClimb = Math.round(climbRef.current);
    onSave({
      minutes,
      distanceKm,
      effort: effort ?? undefined,
      climbM: typedClimb > 0 ? typedClimb : gpsClimb > 5 ? gpsClimb : undefined,
      route: route.length > 1 ? route : undefined,
      avgHr: heart.avgHr(),
    });
  }

  function markLap() {
    setLaps((list) => [...list, { sec: elapsed, km }]);
  }

  return (
    <div className="record-deck fixed inset-0 z-[60] flex flex-col overflow-hidden bg-background text-foreground">
      <div className="relative min-h-0 flex-1">
        <RouteMap
          points={points}
          destination={destination}
          onDestination={setDestination}
          heading={heading}
          accuracyM={accuracyM}
          imperial={imperial}
          sport={sport}
          targetKm={targetKm}
          topInset={118}
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-3 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <button type="button" className="pointer-events-auto h-11 rounded-full bg-background/95 px-4 text-sm font-semibold shadow-[var(--shadow-border)]" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="pointer-events-auto h-11 rounded-full bg-background/95 px-4 text-sm font-semibold shadow-[var(--shadow-border)]"
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
        <div className="pointer-events-none absolute inset-x-3 top-[max(3.6rem,calc(env(safe-area-inset-top)+2.8rem))] z-20 grid grid-cols-3 gap-1.5">
          <OverlayStat label="Time" value={formatClock(elapsed)} />
          <OverlayStat label={unit === "mi" ? "Miles" : "Km"} value={distance || "0"} />
          <OverlayStat label={sport === "ride" ? "Speed" : "Pace"} value={pace ?? "—"} />
        </div>
        {gpsNote ? (
          <p className="pointer-events-none absolute inset-x-3 top-36 z-20 rounded-xl bg-background/95 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {gpsNote}
          </p>
        ) : null}
      </div>

      <div className="max-h-[42%] overflow-y-auto border-t border-border bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        <p className="truncate text-xs font-semibold">{title}</p>
        <p className="truncate text-[11px] text-muted-foreground">{note}</p>
        <HeartRow
          age={age}
          bpm={heart.bpm}
          spo2={spo2}
          state={heart.state}
          onConnect={() => void heart.connect()}
          onType={heart.setBpm}
          override={heart.override}
          onOverride={heart.acknowledge}
          showWarn={false}
          compact
        />
        {!heart.override ? <HeartWarn call={heart.call} onOverride={heart.acknowledge} /> : null}

        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">
              {unit === "mi" ? "Miles" : "Kilometres"}
              {!distanceTouched && gpsKm >= 0.02 ? " · GPS" : !distanceTouched && targetKm ? " · set for you" : ""}
            </span>
            <input
              inputMode="decimal"
              value={distance}
              placeholder="0"
              onChange={(e) => {
                setDistanceTouched(true);
                setDistance(e.target.value.replace(/[^\d.]/g, "").slice(0, 6));
              }}
              className="mt-1 h-12 w-full rounded-2xl bg-card px-3 font-display text-2xl tabular-nums"
            />
          </label>
          {sport === "ride" ? (
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">
                Climb, metres{!climb && climbRef.current > 5 ? " · phone" : ""}
              </span>
              <input
                inputMode="numeric"
                value={climb}
                placeholder={climbRef.current > 5 ? String(Math.round(climbRef.current)) : "0"}
                onChange={(e) => setClimb(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
                className="mt-1 h-12 w-full rounded-2xl bg-card px-3 font-display text-2xl tabular-nums"
              />
            </label>
          ) : (
            <div className="flex flex-col justify-end">
              <button type="button" className="h-12 rounded-2xl bg-card text-sm font-semibold" onClick={markLap}>
                Lap
              </button>
            </div>
          )}
        </div>

        {sport === "ride" ? (
          <div className="mt-2 grid grid-cols-5 gap-1" role="group" aria-label="How the ride felt">
            {RIDE_EFFORTS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setEffort(item.id)}
                className={cn(
                  "h-10 rounded-xl text-xs font-semibold",
                  effort === item.id ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}

        {laps.length ? (
          <ol className="mt-2 space-y-1">
            {laps.map((lap, index) => {
              const prev = laps[index - 1];
              const sec = lap.sec - (prev?.sec ?? 0);
              const delta = lap.km - (prev?.km ?? 0);
              const split = activityPace(delta, sec / 60, imperial, sport);
              return (
                <li key={`${lap.sec}-${index}`} className="flex justify-between text-sm tabular-nums">
                  <span>Split {index + 1}</span>
                  <span>
                    {formatClock(sec)}
                    {split ? ` · ${split}` : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}

        <button
          type="button"
          className="mt-3 h-12 w-full rounded-2xl bg-primary text-base font-semibold text-primary-foreground"
          onClick={finish}
        >
          Finish
        </button>
        <p className="mt-1 text-center text-[11px] leading-relaxed text-muted-foreground">
          {elapsed < 300 ? "Under 5 minutes still logs as 5. " : ""}
          {!distanceTouched && gpsKm >= 0.02
            ? "The line updates as you move. GPS distance is saved unless you edit it."
            : "Until GPS locks, distance stays the one set from your pace."}
        </p>
      </div>
    </div>
  );
}

function OverlayStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-background/90 px-2 py-1.5 text-center shadow-[var(--shadow-border)]">
      <p className="truncate font-display text-xl tabular-nums leading-none">{value}</p>
      <p className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

function shownDistance(km: number, imperial: boolean): string {
  const n = kmToShown(km, imperial);
  const digits = n >= 10 ? 1 : 2;
  return String(Number(n.toFixed(digits)));
}
