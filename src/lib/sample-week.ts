import type { PlannedMeal, Recipe } from "./types";

/** f3: a sample-week weeknight dinner must fit a 5pm start. */
export const WEEKNIGHT_MAX_MINUTES = 60;

/** Mon–Thu (Friday counts as the start of the weekend for a long cook). */
export function isWeeknight(date: string): boolean {
  const day = new Date(`${date}T12:00:00`).getDay();
  return day >= 1 && day <= 4;
}

export function weeknightFits(recipe: Pick<Recipe, "minutes"> | undefined): boolean {
  return !recipe || recipe.minutes <= WEEKNIGHT_MAX_MINUTES;
}

/** Weekend days a long cook may move to, best first. */
function weekendOrder(dates: string[]): string[] {
  const rank = (d: string) => ({ 0: 0, 6: 1, 5: 2 })[new Date(`${d}T12:00:00`).getDay()] ?? 9;
  return dates.filter((d) => rank(d) < 9).sort((a, b) => rank(a) - rank(b));
}

/**
 * Deterministic post-pass on a filled sample week: a weeknight dinner over 60 minutes
 * (Holiday prime rib, 3h) trades places with a quick weekend dinner (Sunday first, then
 * Saturday, Friday). With no weekend slot to trade, the weeknight gets the first unused
 * quick recipe from `pool` (in pool order). Other meals, skips and custom meals are untouched.
 */
export function weeknightSafe(
  meals: PlannedMeal[],
  dates: string[],
  recipeOf: (id: string) => Recipe | undefined,
  pool: Recipe[] = [],
): PlannedMeal[] {
  const out = meals.map((m) => ({ ...m }));
  const dinner = (date: string) => out.find((m) => m.date === date && m.slot === "dinner" && !m.skip && m.recipeId);
  const used = new Set(out.filter((m) => m.recipeId).map((m) => m.recipeId as string));
  for (const date of dates) {
    if (!isWeeknight(date)) continue;
    const meal = dinner(date);
    if (!meal || weeknightFits(recipeOf(meal.recipeId!))) continue;
    const target = weekendOrder(dates)
      .map((d) => dinner(d))
      .find((m) => m && weeknightFits(recipeOf(m.recipeId!)));
    if (target) {
      const id = meal.recipeId;
      meal.recipeId = target.recipeId;
      target.recipeId = id;
      continue;
    }
    const quick = pool.find((r) => !used.has(r.id) && weeknightFits(r));
    if (quick) {
      used.add(quick.id);
      meal.recipeId = quick.id;
    }
  }
  return out;
}
