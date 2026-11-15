import { ChevronLeft, Dumbbell, Flame, Library, Scale } from "lucide-react";
import { useState } from "react";
import { ExerciseLibrary } from "@/components/exercise-library";
import { ExerciseSheet } from "@/components/exercise-sheet";
import { FitView } from "@/components/fit-view";
import { LiftSheet, type LiftSeed } from "@/components/lift-sheet";
import { TrainHome } from "@/components/train-home";
import { TrainView } from "@/components/train-view";
import { exerciseById, type Exercise } from "@/lib/exercises";
import { isoDate } from "@/lib/fuel";
import { useSpoonful } from "@/lib/spoonful-store";
import { normalizeTrainFocus } from "@/lib/train-focus";
import { cn } from "@/lib/utils";

type Pane = "today" | "train" | "macros";

export function FitnessApp({
  initialPane,
  onClose,
  onOpenStore,
}: {
  initialPane: "today" | "train";
  onClose: () => void;
  onOpenStore: () => void;
}) {
  const [pane, setPane] = useState<Pane>(initialPane);
  const [library, setLibrary] = useState(false);
  const [detail, setDetail] = useState<Exercise | null>(null);
  const [liftOpen, setLiftOpen] = useState(false);
  const [liftSeed, setLiftSeed] = useState<LiftSeed | undefined>();
  const favMoves = useSpoonful((s) => s.favMoves);
  const focus = normalizeTrainFocus(useSpoonful((s) => s.trainFocus));
  const title =
    pane === "macros"
      ? "Macros"
      : pane === "train"
        ? focus === "weights"
          ? "Train"
          : "Week"
        : focus === "run"
          ? "Run"
          : focus === "ride"
            ? "Ride"
            : focus === "home"
              ? "At home"
              : "Weights";

  return (
    <div className="fit-stage fixed inset-0 z-[45] flex h-dvh flex-col" data-sport={focus} data-tour="train-hud">
      <header className="flex shrink-0 items-center gap-2 px-3 pt-[max(0.4rem,env(safe-area-inset-top))]">
        <button
          type="button"
          className="flex h-11 items-center gap-0.5 rounded-full pr-3 text-sm font-semibold"
          onClick={onClose}
        >
          <ChevronLeft className="size-5" />
          Spoonful
        </button>
        <h1 className="min-w-0 flex-1 text-center font-display text-lg" data-tour="fitness-head">
          {title}
        </h1>
        <button
          type="button"
          className="flex size-11 items-center justify-center rounded-full"
          aria-label="Exercise library"
          data-tour="library"
          onClick={() => setLibrary(true)}
        >
          <Library className="size-5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {pane === "today" || (pane === "train" && focus !== "weights") ? (
          <TrainHome
            layout={pane === "train" ? "week" : "today"}
            onOpenMacros={() => setPane("macros")}
            onOpenTrain={() => setPane("train")}
            onStartLift={(session) => {
              setLiftSeed({
                name: session.name,
                date: session.date,
                moveIds: session.moves.map((m) => m.moveId),
                plan: session.moves.map((m) => ({ moveId: m.moveId, sets: m.sets, reps: m.reps })),
              });
              setLiftOpen(true);
            }}
          />
        ) : null}
        {pane === "train" && focus === "weights" ? (
          <TrainView embedded onOpenStore={onOpenStore} onOpenFuel={() => setPane("macros")} />
        ) : null}
        {pane === "macros" ? <FitView onOpenStore={onOpenStore} onOpenTrain={() => setPane("train")} /> : null}
      </div>

      {library || detail || liftOpen ? null : (
        <nav
          className="grid shrink-0 grid-cols-3 border-t border-border bg-background pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1"
          aria-label="Fitness"
        >
          {(
            [
              { id: "today" as const, label: focus === "run" ? "You" : focus === "ride" ? "Ride" : focus === "home" ? "Home" : "Today", icon: Flame },
              { id: "train" as const, label: focus === "weights" ? "Week" : focus === "home" ? "Library" : "Plan", icon: Dumbbell },
              { id: "macros" as const, label: focus === "weights" ? "Macros" : "Fuel", icon: Scale },
            ]
          ).map((item) => {
            const Icon = item.icon;
            const on = pane === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setPane(item.id)}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold",
                  on ? "text-spark" : "text-muted-foreground",
                )}
              >
                <Icon className="size-5" strokeWidth={on ? 2.4 : 1.8} />
                {item.label}
              </button>
            );
          })}
        </nav>
      )}

      {library ? (
        <ExerciseLibrary
          favMoves={favMoves}
          onClose={() => setLibrary(false)}
          onOpen={(ex) => setDetail(ex)}
        />
      ) : null}
      {detail ? (
        <ExerciseSheet
          exercise={detail}
          onClose={() => setDetail(null)}
          onStart={(id) => {
            setDetail(null);
            setLibrary(false);
            setLiftSeed({ name: exerciseById(id)?.name ?? "Lift", date: isoDate(), moveIds: [id] });
            setLiftOpen(true);
          }}
        />
      ) : null}
      <LiftSheet open={liftOpen} onClose={() => setLiftOpen(false)} seed={liftSeed} />
    </div>
  );
}

