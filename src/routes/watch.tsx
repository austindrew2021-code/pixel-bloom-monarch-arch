import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plate } from "@/components/plate";
import { RouteSpark } from "@/components/route-map";
import { TesterGate } from "@/components/tester-gate";
import { dayFuel, isoDate } from "@/lib/fuel";
import { resolvedTimeLabel } from "@/lib/recipe-time";
import { nutritionForDate, resolveMeal, useSpoonful } from "@/lib/spoonful-store";
import { rankProgress } from "@/lib/ranks";
import { isTesterUnlocked } from "@/lib/tester";
import { normalizeTheme } from "@/lib/themes";

export const Route = createFileRoute("/watch")({ component: WatchFace });

function WatchFace() {
  const meals = useSpoonful((s) => s.meals);
  const goal = useSpoonful((s) => s.goal);
  const workouts = useSpoonful((s) => s.workouts);
  const stepsByDate = useSpoonful((s) => s.stepsByDate);
  const snacks = useSpoonful((s) => s.snacks);
  const portionMultByDate = useSpoonful((s) => s.portionMultByDate);
  const cookedDates = useSpoonful((s) => s.cookedDates);
  const xp = useSpoonful((s) => s.xp);
  const onboarded = useSpoonful((s) => s.onboarded);
  const body = useSpoonful((s) => s.body);
  const health = useSpoonful((s) => s.healthByDate[isoDate()]);
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    setAllowed(isTesterUnlocked());
    const done = useSpoonful.persist.rehydrate();
    void Promise.resolve(done).then(() => {
      document.documentElement.dataset.theme = normalizeTheme(useSpoonful.getState().theme);
    });
  }, []);

  const today = isoDate();
  const dinner = meals.find((m) => m.date === today && m.slot === "dinner");
  const resolved = dinner ? resolveMeal(dinner) : null;
  const fuel = dayFuel({
    goal,
    eaten: nutritionForDate(meals, today, snacks, portionMultByDate, cookedDates),
    workouts: workouts.filter((w) => w.date === today),
    steps: stepsByDate[today] ?? 0,
    body,
  });
  const rank = rankProgress(xp);
  const lastLine = [...workouts].reverse().find((workout) => workout.route && workout.route.length > 1);

  if (allowed !== true) {
    if (allowed === false) return <TesterGate onUnlock={() => setAllowed(true)} />;
    return <main className="min-h-dvh bg-background" />;
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-6 text-foreground">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-spark">Watch face</p>
      <p className="mt-1 text-center text-xs text-muted-foreground">Apple Watch · Wear OS · phone</p>
      {!onboarded ? (
        <p className="mt-4 text-center text-sm text-muted-foreground">Open Spoonful on your phone and plate tonight first.</p>
      ) : resolved && !resolved.skip ? (
        <>
          <Plate kind={resolved.recipe?.plate ?? "bowl"} size="lg" className="mt-4" />
          <h1 className="mt-3 text-center font-display text-3xl leading-tight">{resolved.title}</h1>
          {resolvedTimeLabel(resolved) ? <p className="mt-1 text-sm text-muted-foreground">{resolvedTimeLabel(resolved)}</p> : null}
        </>
      ) : (
        <h1 className="mt-4 text-center font-display text-3xl">Nothing plated</h1>
      )}
      <p className="mt-6 font-display text-2xl tabular-nums">{Math.round(fuel.remaining.cal)}</p>
      <p className="text-xs text-muted-foreground">kcal left · {fuel.remaining.protein}g protein</p>
      <p className="mt-3 text-sm tabular-nums text-muted-foreground">
        {health?.sleepHours ? `${health.sleepHours} h sleep` : "Sleep not logged"}
        {health?.restingHr ? ` · resting ${health.restingHr}` : ""}
        {stepsByDate[today] ? ` · ${stepsByDate[today].toLocaleString()} steps` : ""}
      </p>
      {lastLine?.route ? (
        <div className="mt-3 flex items-center gap-2">
          <RouteSpark points={lastLine.route} />
          <p className="text-xs text-muted-foreground">Last route is on the phone that recorded it.</p>
        </div>
      ) : null}
      <p className="mt-3 max-w-xs text-center text-xs leading-relaxed text-muted-foreground">
        Heart rate and the live map stay on the phone while you record. This face is the plate.
      </p>
      <p className="mt-4 text-sm font-medium">{rank.current.title}</p>
      <a href="/" className="mt-6 text-sm text-spark">
        Open kitchen
      </a>
    </main>
  );
}
