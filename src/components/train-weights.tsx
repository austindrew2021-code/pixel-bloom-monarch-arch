import { useEffect, useState } from "react";
import { toast } from "sonner";
import { lbFromKg } from "@/lib/body";
import { exerciseById, type MuscleId } from "@/lib/exercises";
import { bestEpley, platesPerSide } from "@/lib/lift";
import { sessionFuelDelta, resolveStatus, type ProgramSession } from "@/lib/program";
import {
  anchorOneRm,
  prescribeSets,
  priorDates,
  proteinHold,
  repWindow,
  repsForLoad,
} from "@/lib/prescribe";
import { isoDate } from "@/lib/fuel";
import { nutritionForDate, useSpoonful } from "@/lib/spoonful-store";
import { recoveryHold } from "@/lib/workout-safety";
import { cn } from "@/lib/utils";
import { dayLabel } from "@/lib/week";

const MUSCLES: { id: MuscleId; label: string }[] = [
  { id: "chest", label: "Chest" },
  { id: "lats", label: "Back" },
  { id: "front-delts", label: "Shoulders" },
  { id: "quads", label: "Quads" },
  { id: "hamstrings", label: "Hamstrings" },
  { id: "abs", label: "Abs" },
];

export function TrainWeights({
  sessions,
  today,
  imperial,
  layout,
  left,
  protein,
  proteinTarget,
  onOpenMacros,
  onOpenTrain,
  onStartLift,
}: {
  sessions: ProgramSession[];
  today: string;
  imperial: boolean;
  layout: "today" | "week";
  left: number;
  protein: number;
  proteinTarget: number;
  onOpenMacros: () => void;
  onOpenTrain: () => void;
  onStartLift: (session: ProgramSession) => void;
}) {
  const lifts = useSpoonful((s) => s.liftSessions);
  const body = useSpoonful((s) => s.body);
  const macroGoal = useSpoonful((s) => s.goal);
  const meals = useSpoonful((s) => s.meals);
  const snacks = useSpoonful((s) => s.snacks);
  const cookedDates = useSpoonful((s) => s.cookedDates);
  const portionMultByDate = useSpoonful((s) => s.portionMultByDate);
  const addWorkout = useSpoonful((s) => s.addWorkout);
  const markSession = useSpoonful((s) => s.markSession);
  const healthToday = useSpoonful((s) => s.healthByDate[isoDate()]);
  const sleptPoor = recoveryHold(healthToday);
  const hold = proteinHold(
    priorDates(isoDate(), 3).map((date) => ({
      eaten: nutritionForDate(meals, date, snacks, portionMultByDate, cookedDates).protein,
      target: macroGoal.protein,
    })),
  );
  const todaySession = sessions.find((s) => s.date === today);
  const nextLift =
    sessions.find((s) => s.kind === "lift" && s.date >= today) ?? sessions.find((s) => s.kind === "lift");
  const [picked, setPicked] = useState("");
  useEffect(() => {
    if (picked && sessions.some((s) => s.date === picked)) return;
    const todayIsLift = sessions.find((s) => s.date === today)?.kind === "lift";
    const next = todayIsLift ? today : nextLift?.date;
    if (next) setPicked(next);
  }, [sessions, picked, today, nextLift]);
  const selected = sessions.find((s) => s.date === picked) ?? sessions.find((s) => s.date === today);
  const progressionHold = hold || (sleptPoor && selected?.date === today);
  const liftDays = sessions.filter((s) => s.kind === "lift");
  const goal = liftDays.length || 4;
  const done = liftDays.filter((s) => resolveStatus(s, today) === "done").length;
  const status = selected ? resolveStatus(selected, today) : "planned";
  const unit = imperial ? "lb" : "kg";

  return (
    <div>
      <section className="mt-4" data-tour="week">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl">This week</h2>
          <p className="text-sm tabular-nums text-muted-foreground">
            {done} of {goal}
          </p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <span className="block h-full bg-primary" style={{ width: `${Math.min(100, (done / goal) * 100)}%` }} />
        </div>
      </section>

      <button
        type="button"
        onClick={onOpenMacros}
        data-tour="fuel-now"
        className="mt-3 flex w-full items-center justify-between rounded-2xl bg-card px-4 py-3 text-left"
      >
        <span className="text-sm text-muted-foreground">{left < 0 ? "Over today" : "Left today"}</span>
        <span className="font-display text-2xl tabular-nums">{Math.abs(left)} kcal</span>
        <span className="text-xs text-muted-foreground">
          {protein}/{proteinTarget}g
        </span>
      </button>

      {sessions.length ? (
        <ol className="mt-4 grid grid-cols-7 gap-1">
          {sessions.map((session) => {
            const meta = dayLabel(session.date);
            const on = picked === session.date;
            const st = resolveStatus(session, today);
            return (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => setPicked(session.date)}
                  className={cn(
                    "flex h-12 w-full flex-col items-center justify-center rounded-2xl text-xs",
                    on ? "bg-primary text-primary-foreground" : "bg-card",
                  )}
                >
                  <span className="uppercase tracking-wide opacity-70">{meta.weekday.slice(0, 2)}</span>
                  <span
                    className={cn(
                      "mt-1 size-1.5 rounded-full",
                      st === "done" ? "bg-current" : session.kind === "rest" ? "bg-current opacity-25" : "bg-spark",
                    )}
                  />
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">Building this week’s lifts.</p>
      )}

      {selected && picked !== today && todaySession && todaySession.kind !== "lift" ? (
        <button type="button" className="mt-3 text-sm font-semibold text-muted-foreground" onClick={() => setPicked(today)}>
          Today is {todaySession.name}. Show that instead.
        </button>
      ) : null}
      {selected ? (
        <section className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {selected.date === today ? "Today" : dayLabel(selected.date).weekday}
            {status === "done" ? " · done" : ""}
            {layout === "week" ? " · pick a day above" : ""}
          </p>
          <h2 className="mt-1 font-display text-4xl leading-none">{selected.name}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{selected.why}</p>
          {selected.kind === "lift" ? (
            <button
              type="button"
              className="mt-4 h-14 w-full rounded-2xl bg-primary text-base font-semibold text-primary-foreground"
              data-tour="start-session"
              onClick={() => onStartLift(selected)}
            >
              Start workout
            </button>
          ) : selected.kind === "rest" ? (
            <button
              type="button"
              className="mt-4 h-14 w-full rounded-2xl bg-primary text-base font-semibold text-primary-foreground"
              data-tour="start-session"
              onClick={() => {
                addWorkout({ date: today, kind: "walk", minutes: 20 });
                toast("Walk saved. Calories moved.");
              }}
            >
              Easy walk · 20 min
            </button>
          ) : (
            <button
              type="button"
              className="mt-4 h-14 w-full rounded-2xl bg-primary text-base font-semibold text-primary-foreground"
              data-tour="start-session"
              onClick={() => {
                const name = markSession(selected.id, "done");
                toast(name ? `Logged · dinner is ${name}` : "Logged. Calories moved.");
              }}
            >
              Log {selected.minutes} min
            </button>
          )}
          {hold ? (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Protein has been under target, so the working weight stays. It still drops if the last two sessions were a grind.
            </p>
          ) : null}
          {sleptPoor && selected.date === today ? (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Short sleep or low recovery, so today’s weight stays put. It still drops if the last two sessions were a grind.
            </p>
          ) : null}
          {selected.kind !== "rest" ? (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {(() => {
                const fuel = sessionFuelDelta(selected, body.weightKg);
                return fuel.burn > 0
                  ? `Tonight moves with this: +${fuel.burn} kcal, +${fuel.carbs}g carbs, +${fuel.protein}g protein.`
                  : "";
              })()}
            </p>
          ) : null}

          <section className="mt-5 space-y-2">
            <h2 className="text-sm font-semibold">Recovery</h2>
            {MUSCLES.map((muscle) => {
              const ready = recovered(muscleHours(lifts, today, muscle.id));
              return (
                <div key={muscle.id} className="grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-2">
                  <span className="text-sm">{muscle.label}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full bg-primary" style={{ width: `${ready}%` }} />
                  </span>
                  <span className="text-right text-sm tabular-nums text-muted-foreground">{ready}%</span>
                </div>
              );
            })}
            <p className="text-xs leading-relaxed text-muted-foreground">
              100% means three days since a logged set, or you have not logged that muscle. It is not a body scan.
            </p>
          </section>

          {selected.kind === "lift" && selected.moves.length ? (
            <ul className="mt-4 divide-y divide-border overflow-hidden rounded-2xl bg-card">
              {selected.moves.map((move) => {
                const ex = exerciseById(move.moveId);
                const prescribed = prescribeSets({
                  moveId: move.moveId,
                  sessions: lifts,
                  bodyKg: body.weightKg,
                  imperial,
                  goalKind: body.goalKind,
                  hold: progressionHold,
                  planned: { sets: move.sets, reps: move.reps },
                }).filter((set) => !set.warmup);
                const work = prescribed[0];
                const window = repWindow(move.reps, body.goalKind);
                const best = bestEpley(lifts, move.moveId);
                const reps =
                  work && !window.timed
                    ? repsForLoad(work.weightKg, anchorOneRm(best, work.weightKg, window.min), window.min, window.max)
                    : null;
                const weight =
                  work && work.weightKg > 0 && !ex?.bodyweight
                    ? imperial
                      ? Math.round(lbFromKg(work.weightKg))
                      : Math.round(work.weightKg * 10) / 10
                    : null;
                const plates =
                  ex?.bar && work && work.weightKg > 0
                    ? platesPerSide(work.weightKg, imperial)
                        .flatMap((plate) => Array.from({ length: plate.count }, () => plate.plate))
                        .join("+")
                    : "";
                return (
                  <li key={move.moveId} className="flex items-center gap-3 px-3 py-3">
                    {ex?.image ? (
                      <img src={ex.image} alt="" className="size-12 shrink-0 rounded-xl bg-muted object-cover" />
                    ) : (
                      <span className="size-12 shrink-0 rounded-xl bg-muted" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{ex?.name ?? move.moveId}</span>
                      <span className="block text-xs text-muted-foreground">
                        {prescribed.length || move.sets} × {reps ?? move.reps}
                        {plates ? ` · side ${plates}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-display text-xl tabular-nums leading-none">{weight ?? "—"}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{weight == null ? "body" : unit}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <button type="button" className="mt-3 h-11 text-sm font-semibold text-muted-foreground" onClick={onOpenTrain}>
            {layout === "week" ? "Swap a move in the week" : "Open the full week"}
          </button>
        </section>
      ) : null}
    </div>
  );
}

function muscleHours(
  sessions: { date: string; lines: { moveId: string; sets: { done: boolean; warmup?: boolean }[] }[] }[],
  today: string,
  muscle: MuscleId,
): number | null {
  const now = Date.parse(`${today}T12:00:00`);
  let last = 0;
  for (const session of sessions) {
    const t = Date.parse(`${session.date}T12:00:00`);
    if (Number.isNaN(t) || t > now) continue;
    for (const line of session.lines) {
      if (!line.sets.some((set) => set.done && !set.warmup)) continue;
      const ex = exerciseById(line.moveId);
      if (!ex?.primary.includes(muscle)) continue;
      if (t > last) last = t;
    }
  }
  if (!last) return null;
  return (now - last) / 36e5;
}

function recovered(hours: number | null): number {
  if (hours == null) return 100;
  if (hours < 12) return 20;
  if (hours < 24) return 40;
  if (hours < 36) return 60;
  if (hours < 48) return 75;
  if (hours < 72) return 90;
  return 100;
}
