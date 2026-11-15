import { useState } from "react";
import { toast } from "sonner";
import { TrainRecord } from "@/components/train-record";
import { RouteSpark } from "@/components/route-map";
import { prescribeCardio } from "@/lib/prescribe";
import { useSpoonful } from "@/lib/spoonful-store";
import {
  activityPace,
  enduranceDay,
  enduranceWeek,
  formatDistance,
  sumKm,
} from "@/lib/train-focus";
import { recoveryHold } from "@/lib/workout-safety";
import type { Workout, WorkoutKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { dayLabel, shiftWeek, weekDates } from "@/lib/week";

export function TrainRun({
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
  const mine = workouts.filter((w) => w.kind === "run" || w.kind === "walk");
  const recentAll = [...mine].reverse();
  const thisKm = sumKm(mine, dates);
  const lastKm = sumKm(mine, weekDates(shiftWeek(weekStart, -1)));
  const byDay = dates.map((date) => sumKm(mine, [date]));
  const peak = Math.max(0.01, ...byDay);
  const [picked, setPicked] = useState(dates.includes(today) ? today : dates[0]!);
  const [recording, setRecording] = useState(false);
  const plan = enduranceDay("run", picked);
  const rx = prescribeCardio({
    planMinutes: plan.minutes,
    kind: plan.kind,
    goalKind,
    recent: recentAll.map((workout) => ({ minutes: workout.minutes, distanceKm: workout.distanceKm })),
    ease: picked === today && eased,
  });
  const delta = thisKm - lastKm;
  const recent = [...mine].reverse().slice(0, 6);
  const compare =
    lastKm <= 0 && thisKm <= 0
      ? "Nothing logged yet. The first run starts the week."
      : delta >= 0.05
        ? `${formatDistance(delta, imperial)} more than last week`
        : delta <= -0.05
          ? `${formatDistance(Math.abs(delta), imperial)} less than last week`
          : "Level with last week";

  function save(
    date: string,
    kind: WorkoutKind,
    minutes: number,
    distanceKm?: number,
    extra?: { route?: { lat: number; lng: number }[]; avgHr?: number },
  ) {
    addWorkout({ date, kind, minutes, distanceKm, route: extra?.route, avgHr: extra?.avgHr });
    toast(distanceKm ? "Saved. Pace is on the list, and calories moved." : "Saved. Calories moved with the time.");
  }

  return (
    <div>
      <section className="mt-5">
        <p className="text-sm text-muted-foreground">This week</p>
        <p className="font-display text-6xl tabular-nums leading-none text-spark">{formatDistance(thisKm, imperial).split(" ")[0]}</p>
        <p className="mt-1 text-lg">{formatDistance(thisKm, imperial).split(" ")[1]}</p>
        <p className="mt-1 text-sm text-muted-foreground">{compare}</p>
      </section>

      <button
        type="button"
        onClick={onOpenMacros}
        data-tour="fuel-now"
        className="mt-4 flex w-full items-center justify-between rounded-2xl bg-card px-4 py-3 text-left"
      >
        <span className="text-sm text-muted-foreground">{left < 0 ? "Over" : "Food left"}</span>
        <span className="font-display text-2xl tabular-nums">{Math.abs(left)}</span>
        <span className="text-xs text-muted-foreground">{protein}/{proteinTarget}g protein</span>
      </button>

      <div className="mt-5 flex h-24 items-end gap-2" data-tour="week">
        {dates.map((date, i) => (
          <button key={date} type="button" onClick={() => setPicked(date)} className="flex h-full flex-1 flex-col justify-end gap-1">
            <span
              className={cn("block w-full rounded-md", picked === date ? "bg-spark" : "bg-muted")}
              style={{ height: `${Math.max(10, (byDay[i]! / peak) * 100)}%` }}
            />
            <span className="text-center text-xs text-muted-foreground">{dayLabel(date).weekday.slice(0, 1)}</span>
          </button>
        ))}
      </div>

      {layout === "week" ? (
        <ul className="mt-4 space-y-2">
          {enduranceWeek("run").map((day, i) => (
            <li key={dates[i]}>
              <button
                type="button"
                onClick={() => setPicked(dates[i]!)}
                className={cn(
                  "flex h-14 w-full items-center justify-between rounded-2xl px-4 text-left",
                  picked === dates[i] ? "bg-primary text-primary-foreground" : "bg-card",
                )}
              >
                <span>
                  <span className="block text-xs uppercase tracking-wide opacity-70">{dayLabel(dates[i]!).weekday}</span>
                  <span className="font-medium">{day.name}</span>
                </span>
                <span className="text-sm tabular-nums">{day.kind === "rest" ? "Off" : `${prescribeCardio({
                  planMinutes: day.minutes,
                  kind: day.kind,
                  goalKind,
                  recent: recentAll.map((workout) => ({ minutes: workout.minutes, distanceKm: workout.distanceKm })),
                  ease: dates[i] === today && eased,
                }).minutes} min`}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <section className="mt-5 flex items-center gap-4 rounded-3xl bg-card p-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {dayLabel(picked).today ? "Today" : dayLabel(picked).weekday}
          </p>
          <h2 className="mt-1 font-display text-3xl leading-none">{plan.name}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{rx.note}</p>
          {plan.kind !== "rest" ? (
            <p className="mt-2 text-sm tabular-nums">
              {rx.minutes} min
              {rx.distanceKm ? ` · ${formatDistance(rx.distanceKm, imperial)}` : ""}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          data-tour="start-session"
          aria-label={plan.kind === "rest" ? "Log an easy walk" : "Record this run"}
          className="flex size-16 shrink-0 items-center justify-center rounded-full bg-spark text-sm font-semibold text-spark-foreground"
          onClick={() => (plan.kind === "rest" ? save(picked, "walk", 20) : setRecording(true))}
        >
          {plan.kind === "rest" ? "Walk" : "Go"}
        </button>
      </section>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Time and distance follow your goal, your last runs, and last night’s sleep. The map is this phone’s GPS. A short night keeps the day easier.
      </p>

      <ActivityList recent={recent} imperial={imperial} />

      {recording ? (
        <TrainRecord
          sport="run"
          title={plan.name}
          note={rx.note}
          imperial={imperial}
          targetMinutes={rx.minutes || plan.minutes}
          targetKm={rx.distanceKm}
          onClose={() => setRecording(false)}
          onSave={(result) => {
            const kind: WorkoutKind = plan.kind === "walk" ? "walk" : "run";
            save(picked, kind, result.minutes, result.distanceKm, { route: result.route, avgHr: result.avgHr });
            setRecording(false);
          }}
        />
      ) : null}
    </div>
  );
}

function ActivityList({ recent, imperial }: { recent: Workout[]; imperial: boolean }) {
  if (!recent.length) return null;
  return (
    <ul className="mt-5 divide-y divide-border overflow-hidden rounded-2xl bg-card">
      {recent.map((workout) => {
        const pace = activityPace(workout.distanceKm ?? 0, workout.minutes, imperial, workout.kind === "walk" ? "walk" : "run");
        return (
          <li key={workout.id} className="flex items-baseline justify-between gap-3 px-4 py-3">
            <span>
              <span className="block text-xs uppercase tracking-wide text-muted-foreground">{dayLabel(workout.date).weekday}</span>
              <span className="font-medium capitalize">{workout.kind}</span>
            </span>
            <span className="flex items-center gap-2 text-right text-sm tabular-nums">
              {workout.route && workout.route.length > 1 ? <RouteSpark points={workout.route} /> : null}
              <span>
                {workout.distanceKm ? formatDistance(workout.distanceKm, imperial) : `${workout.minutes} min`}
                {pace ? <span className="mt-0.5 block text-xs text-muted-foreground">{pace}</span> : null}
                {workout.avgHr ? <span className="mt-0.5 block text-xs text-muted-foreground">{workout.avgHr} bpm avg</span> : null}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
