import { useEffect } from "react";
import { TrainRide } from "@/components/train-ride";
import { TrainRun } from "@/components/train-run";
import { TrainStudio } from "@/components/train-studio";
import { TrainWeights } from "@/components/train-weights";
import { applyHealthToFuel, dayFuel, isoDate } from "@/lib/fuel";
import { expectedWorkoutsForDate, type ProgramSession } from "@/lib/program";
import { nutritionForDate, useSpoonful } from "@/lib/spoonful-store";
import { priorDates, proteinHold } from "@/lib/prescribe";
import { TRAIN_FOCI, normalizeTrainFocus } from "@/lib/train-focus";
import { recoveryHold } from "@/lib/workout-safety";
import { cn } from "@/lib/utils";
import { mondayOf, weekDates } from "@/lib/week";

const TABS = [
  { id: "weights" as const, label: "Weights" },
  { id: "run" as const, label: "Run" },
  { id: "ride" as const, label: "Ride" },
  { id: "home" as const, label: "Home" },
];

export function TrainHome({
  layout,
  onOpenMacros,
  onOpenTrain,
  onStartLift,
}: {
  layout: "today" | "week";
  onOpenMacros: () => void;
  onOpenTrain: () => void;
  onStartLift: (session: ProgramSession) => void;
}) {
  const focus = normalizeTrainFocus(useSpoonful((s) => s.trainFocus));
  const setTrainFocus = useSpoonful((s) => s.setTrainFocus);
  const goal = useSpoonful((s) => s.goal);
  const meals = useSpoonful((s) => s.meals);
  const snacks = useSpoonful((s) => s.snacks);
  const portionMultByDate = useSpoonful((s) => s.portionMultByDate);
  const cookedDates = useSpoonful((s) => s.cookedDates);
  const workouts = useSpoonful((s) => s.workouts);
  const stepsByDate = useSpoonful((s) => s.stepsByDate);
  const body = useSpoonful((s) => s.body);
  const programWeek = useSpoonful((s) => s.programWeek);
  const ensureProgram = useSpoonful((s) => s.ensureProgram);
  const healthByDate = useSpoonful((s) => s.healthByDate) ?? {};
  const today = isoDate();

  useEffect(() => {
    ensureProgram();
  }, [ensureProgram, body.goalKind]);

  const sessions = programWeek?.sessions ?? [];
  const eaten = nutritionForDate(meals, today, snacks, portionMultByDate, cookedDates);
  const health = healthByDate[today];
  const steps = stepsByDate[today] ?? health?.steps ?? 0;
  const loggedToday = workouts.filter((w) => w.date === today);
  const todayWork = expectedWorkoutsForDate({
    date: today,
    today,
    sessions,
    logged: loggedToday,
    bodyKg: body.weightKg,
  });
  let fuel = dayFuel({ goal, eaten, workouts: todayWork, steps, body });
  if (health) fuel = applyHealthToFuel(fuel, health);
  const left = Math.round(fuel.target.cal - fuel.eaten.cal);
  const imperial = body.units !== "metric";
  const weekStart = programWeek?.weekStart ?? mondayOf();
  const dates = weekDates(weekStart);
  const line = TRAIN_FOCI.find((item) => item.id === focus)?.line ?? "";
  const fuelProps = {
    left,
    protein: Math.round(fuel.eaten.protein),
    proteinTarget: Math.round(fuel.target.protein),
    onOpenMacros,
  };
  const shortOnProtein = proteinHold(
    priorDates(today, 3).map((date) => ({
      eaten: nutritionForDate(meals, date, snacks, portionMultByDate, cookedDates).protein,
      target: goal.protein,
    })),
  );
  const easyNight = recoveryHold(health);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-8 pt-2">
      <div className="grid grid-cols-4 gap-1.5" role="tablist" aria-label="Training">
        {TABS.map((item) => {
          const on = focus === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTrainFocus(item.id)}
              className={cn(
                "h-11 rounded-full text-sm font-semibold",
                on ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <p className="sr-only">{line}</p>
      <LastNight />

      {focus === "weights" ? (
        <TrainWeights
          sessions={sessions}
          today={today}
          imperial={imperial}
          layout={layout}
          onOpenTrain={onOpenTrain}
          onStartLift={onStartLift}
          {...fuelProps}
        />
      ) : null}
      {focus === "run" ? (
        <TrainRun dates={dates} weekStart={weekStart} today={today} imperial={imperial} layout={layout} {...fuelProps} />
      ) : null}
      {focus === "ride" ? (
        <TrainRide dates={dates} weekStart={weekStart} today={today} imperial={imperial} layout={layout} {...fuelProps} />
      ) : null}
      {focus === "home" ? (
        <TrainStudio dates={dates} today={today} layout={layout} shortOnProtein={shortOnProtein || easyNight} {...fuelProps} />
      ) : null}
    </div>
  );
}

function LastNight() {
  const today = isoDate();
  const health = useSpoonful((s) => s.healthByDate[today]);
  const steps = useSpoonful((s) => s.stepsByDate[today]);
  const logSleep = useSpoonful((s) => s.logSleep);
  const hours = health?.sleepHours ?? 0;
  const eased = recoveryHold(health);
  const bits = [
    health?.restingHr ? `Resting ${health.restingHr}` : "",
    health?.hrvMs ? `HRV ${Math.round(health.hrvMs)} ms` : "",
    health?.spo2 ? `Oxygen ${Math.round(health.spo2)}%` : "",
    steps || health?.steps ? `${(steps || health?.steps || 0).toLocaleString()} steps` : "",
  ].filter(Boolean);
  return (
    <section className="mt-3 rounded-2xl bg-card px-3 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">Last night</p>
        <p className="text-xs tabular-nums text-muted-foreground">{hours > 0 ? `${hours} h` : "Not logged"}</p>
      </div>
      <div className="mt-2 grid grid-cols-5 gap-1.5">
        {[5, 6, 7, 8, 9].map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => logSleep(h)}
            className={cn(
              "h-10 rounded-full text-xs font-semibold",
              hours > 0 && Math.round(hours) === h ? "bg-primary text-primary-foreground" : "bg-background",
            )}
          >
            {h}h
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {eased
          ? "Short night. Today’s session stays easier, and the plate target keeps more protein."
          : "From a watch, or tap the hours. A short night eases the workout and the plate."}
        {bits.length ? ` ${bits.join(" · ")}.` : ""}
      </p>
    </section>
  );
}
