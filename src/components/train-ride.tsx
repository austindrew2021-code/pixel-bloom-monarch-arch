import { useState } from "react";
import { toast } from "sonner";
import { TrainRecord } from "@/components/train-record";
import { RouteSpark } from "@/components/route-map";
import { prescribeCardio } from "@/lib/prescribe";
import { useSpoonful } from "@/lib/spoonful-store";
import { activityPace, enduranceDay, enduranceWeek, formatClock, formatDistance, RIDE_EFFORTS, sumKm } from "@/lib/train-focus";
import { recoveryHold } from "@/lib/workout-safety";
import type { RideEffort } from "@/lib/types";
import { cn } from "@/lib/utils";
import { dayLabel, shiftWeek, weekDates } from "@/lib/week";

export function TrainRide({
  dates,
  weekStart,
  today,
  imperial,
  layout,
  left,
  protein,
  proteinTarget,
  onOpenMacros,
}: {
  dates: string[];
  weekStart: string;
  today: string;
  imperial: boolean;
  layout: "today" | "week";
  left: number;
  protein: number;
  proteinTarget: number;
  onOpenMacros: () => void;
}) {
  const workouts = useSpoonful((s) => s.workouts);
  const goalKind = useSpoonful((s) => s.body.goalKind);
  const addWorkout = useSpoonful((s) => s.addWorkout);
  const health = useSpoonful((s) => s.healthByDate[today]);
  const eased = recoveryHold(health);
  const mine = workouts.filter((w) => w.kind === "ride");
  const weekRides = mine.filter((w) => dates.includes(w.date));
  const thisKm = sumKm(mine, dates);
  const lastKm = sumKm(mine, weekDates(shiftWeek(weekStart, -1)));
  const thisMin = weekRides.reduce((sum, w) => sum + w.minutes, 0);
  const speed = activityPace(thisKm, thisMin, imperial, "ride");
  const [picked, setPicked] = useState(dates.includes(today) ? today : dates[0]!);
  const [recording, setRecording] = useState(false);
  const plan = enduranceDay("ride", picked);
  const recentAll = [...mine].reverse();
  const rx = prescribeCardio({
    planMinutes: plan.minutes,
    kind: plan.kind,
    goalKind,
    recent: recentAll.map((workout) => ({ minutes: workout.minutes, distanceKm: workout.distanceKm })),
    ease: picked === today && eased,
  });
  const recent = recentAll.slice(0, 6);
  const zoneMin = RIDE_EFFORTS.map((zone) => ({
    ...zone,
    minutes: weekRides.filter((w) => w.effort === zone.id).reduce((sum, w) => sum + w.minutes, 0),
  }));
  const zonePeak = Math.max(1, ...zoneMin.map((z) => z.minutes));
  const climb = weekRides.reduce((sum, w) => sum + (w.climbM ?? 0), 0);

  function save(input: {
    minutes: number;
    distanceKm?: number;
    effort?: RideEffort;
    climbM?: number;
    route?: { lat: number; lng: number }[];
    avgHr?: number;
  }) {
    addWorkout({ date: picked, kind: "ride", ...input });
    toast(input.distanceKm ? "Ride saved. Speed is on the list, and calories moved." : "Ride saved. Calories moved with the time.");
  }

  return (
    <div>
      <section className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Time" value={formatClock(thisMin * 60)} hint="this week" />
        <Stat label="Speed" value={speed ? speed.split(" ")[0]! : "—"} hint={speed ? speed.split(" ").slice(1).join(" ") : imperial ? "mph" : "km/h"} />
        <Stat label="Climb" value={climb ? String(climb) : "—"} hint="metres" />
      </section>

      <button
        type="button"
        onClick={onOpenMacros}
        data-tour="fuel-now"
        className="mt-3 flex w-full items-center justify-between rounded-2xl bg-card px-4 py-3 text-left"
      >
        <span className="text-sm text-muted-foreground">{left < 0 ? "Over" : "Food left"}</span>
        <span className="font-display text-2xl tabular-nums">{Math.abs(left)} kcal</span>
        <span className="text-xs text-muted-foreground">{protein}g protein</span>
      </button>

      <section className="mt-5" data-tour="week">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl">{layout === "week" ? "The plan" : "How the week felt"}</h2>
          <p className="text-xs text-muted-foreground">{formatDistance(thisKm, imperial)}</p>
        </div>
        <ul className="mt-3 space-y-2">
          {zoneMin.map((zone) => (
            <li key={zone.id} className="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-2">
              <span className="text-sm">{zone.label}</span>
              <span className="h-3 overflow-hidden rounded-full bg-muted">
                <span className="block h-full bg-primary" style={{ width: `${(zone.minutes / zonePeak) * 100}%` }} />
              </span>
              <span className="text-right text-xs tabular-nums text-muted-foreground">{zone.minutes ? `${zone.minutes}m` : "—"}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Bars are the effort you marked on each ride. Heart rate is saved when a strap or the typed number is on. Not a power meter.
          {lastKm > 0 ? ` Last week was ${formatDistance(lastKm, imperial)}.` : ""}
        </p>
      </section>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {enduranceWeek("ride").map((day, i) => {
          const date = dates[i]!;
          return (
            <button
              key={date}
              type="button"
              onClick={() => setPicked(date)}
              className={cn(
                "w-36 shrink-0 rounded-2xl p-3 text-left",
                picked === date ? "bg-primary text-primary-foreground" : "bg-card",
              )}
            >
              <span className="block text-xs uppercase tracking-wide opacity-70">{dayLabel(date).weekday}</span>
              <span className="mt-1 block font-medium leading-tight">{day.name}</span>
              <span className="mt-2 block text-sm tabular-nums">
                {day.kind === "rest"
                  ? "Off"
                  : `${prescribeCardio({
                      planMinutes: day.minutes,
                      kind: day.kind,
                      goalKind,
                      recent: recentAll.map((workout) => ({ minutes: workout.minutes, distanceKm: workout.distanceKm })),
                      ease: date === today && eased,
                    }).minutes} min`}
              </span>
            </button>
          );
        })}
      </div>

      <section className="mt-4">
        <h2 className="font-display text-4xl leading-none">{plan.name}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{plan.kind === "rest" ? plan.note : rx.note}</p>
        <button
          type="button"
          data-tour="start-session"
          className="mt-4 h-14 w-full rounded-2xl bg-primary text-base font-semibold text-primary-foreground"
          onClick={() => setRecording(true)}
        >
          Start ride
        </button>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Time and distance follow your goal, your last rides, and last night’s sleep. The map is this phone’s GPS. No segments, no leaderboard.
        </p>
      </section>

      {recent.length ? (
        <ul className="mt-5 divide-y divide-border overflow-hidden rounded-2xl bg-card">
          {recent.map((workout) => {
            const pace = activityPace(workout.distanceKm ?? 0, workout.minutes, imperial, "ride");
            return (
              <li key={workout.id} className="flex items-baseline justify-between gap-3 px-4 py-3">
                <span>
                  <span className="block text-xs uppercase tracking-wide text-muted-foreground">{dayLabel(workout.date).weekday}</span>
                  <span className="font-medium capitalize">{workout.effort ?? "Ride"}</span>
                </span>
                <span className="flex items-center gap-2 text-right text-sm tabular-nums">
                  {workout.route && workout.route.length > 1 ? <RouteSpark points={workout.route} /> : null}
                  <span>
                    {formatClock(workout.minutes * 60)}
                    {pace ? <span className="mt-0.5 block text-xs text-muted-foreground">{pace}</span> : null}
                    {workout.climbM ? <span className="mt-0.5 block text-xs text-muted-foreground">{workout.climbM} m up</span> : null}
                    {workout.avgHr ? <span className="mt-0.5 block text-xs text-muted-foreground">{workout.avgHr} bpm avg</span> : null}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">No rides yet. The first one fills the week.</p>
      )}

      {recording ? (
        <TrainRecord
          sport="ride"
          title={plan.name}
          note={rx.note}
          imperial={imperial}
          targetMinutes={rx.minutes || plan.minutes}
          targetKm={rx.distanceKm}
          onClose={() => setRecording(false)}
          onSave={(result) => {
            save(result);
            setRecording(false);
          }}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl bg-card px-2 py-3 text-center">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate font-display text-2xl tabular-nums leading-tight text-primary">{value}</p>
      <p className="truncate text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
