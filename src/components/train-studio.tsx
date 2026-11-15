import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { HeartRow, HeartWarn, useHeartSession } from "@/components/live-signals";
import { EXERCISES, type Exercise, type MuscleId } from "@/lib/exercises";
import { isoDate } from "@/lib/fuel";
import { useSpoonful } from "@/lib/spoonful-store";
import { heartCall } from "@/lib/workout-safety";
import { cn } from "@/lib/utils";

const WORK_SEC = 40;
const REST_SEC = 20;

type HomeArea = "full" | "core" | "legs" | "push";

const AREAS: { id: HomeArea; label: string }[] = [
  { id: "full", label: "Full body" },
  { id: "push", label: "Push" },
  { id: "legs", label: "Legs" },
  { id: "core", label: "Core" },
];

export function TrainStudio({
  dates,
  today,
  layout,
  left,
  protein,
  proteinTarget,
  shortOnProtein,
  onOpenMacros,
}: {
  dates: string[];
  today: string;
  layout: "today" | "week";
  left: number;
  protein: number;
  proteinTarget: number;
  shortOnProtein?: boolean;
  onOpenMacros: () => void;
}) {
  const workouts = useSpoonful((s) => s.workouts);
  const addWorkout = useSpoonful((s) => s.addWorkout);
  const [minutes, setMinutes] = useState<15 | 30 | 45>(shortOnProtein ? 15 : 30);
  useEffect(() => {
    if (shortOnProtein) setMinutes(15);
  }, [shortOnProtein]);
  const [area, setArea] = useState<HomeArea>("full");
  const plan = useMemo(() => buildHome(area, minutes), [area, minutes]);
  const [player, setPlayer] = useState<{ moves: Exercise[]; rounds: number; planned: number; title: string } | null>(null);
  const done = workouts.filter((w) => w.kind === "class" && dates.includes(w.date));
  const total = done.reduce((sum, w) => sum + w.minutes, 0);
  const library = layout === "week";

  return (
    <div>
      <div className="mt-4 flex items-end justify-between">
        <div>
          <p className="text-sm text-muted-foreground">This week</p>
          <p className="font-display text-4xl tabular-nums leading-none">{total} min</p>
        </div>
        <button type="button" onClick={onOpenMacros} data-tour="fuel-now" className="rounded-full bg-card px-4 py-2 text-sm font-semibold">
          {left < 0 ? `${Math.abs(left)} over` : `${left} left`} · {protein}/{proteinTarget}g
        </button>
      </div>
      {shortOnProtein ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          A short night, low recovery, or protein under target, so this opens at 15 minutes. Pick a longer one if you still want it.
        </p>
      ) : null}

      <div className="mt-4 flex gap-2" data-tour="week">
        {([15, 30, 45] as const).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setMinutes(n)}
            className={cn(
              "h-11 rounded-full px-4 text-sm font-semibold",
              minutes === n ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground",
            )}
          >
            {n} min
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2 overflow-x-auto">
        {AREAS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setArea(item.id)}
            className={cn(
              "h-11 shrink-0 rounded-full px-4 text-sm font-semibold",
              area === item.id ? "bg-foreground text-background" : "bg-card text-muted-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {library ? (
        <ul className="mt-4 space-y-3">
          {AREAS.map((item) => {
            const card = buildHome(item.id, minutes);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setArea(item.id);
                    setPlayer({ moves: card.moves, rounds: card.rounds, planned: card.about, title: `${minutes} min ${item.label}` });
                  }}
                  className="flex w-full items-center gap-3 overflow-hidden rounded-3xl bg-card p-2 text-left"
                >
                  {card.moves[0]?.image ? (
                    <img src={card.moves[0].image} alt="" className="size-20 shrink-0 rounded-2xl object-cover" />
                  ) : (
                    <span className="size-20 shrink-0 rounded-2xl bg-muted" />
                  )}
                  <span>
                    <span className="block font-display text-2xl leading-none">{item.label}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {card.moves.length} moves · {card.rounds} rounds
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <article className="mt-4 overflow-hidden rounded-3xl bg-card">
          {plan.moves[0]?.image ? (
            <img src={plan.moves[0].image} alt="" className="h-52 w-full object-cover" />
          ) : (
            <div className="h-52 bg-muted" />
          )}
          <div className="p-4">
            <h2 className="font-display text-4xl leading-none">
              {minutes} min {AREAS.find((item) => item.id === area)?.label}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {plan.moves.length} moves · {plan.rounds} rounds · about {plan.about} min
            </p>
            <button
              type="button"
              data-tour="start-session"
              className="mt-4 h-14 w-full rounded-full bg-primary text-base font-semibold text-primary-foreground"
              onClick={() =>
                setPlayer({
                  moves: plan.moves,
                  rounds: plan.rounds,
                  planned: plan.about,
                  title: `${minutes} min ${AREAS.find((item) => item.id === area)?.label ?? "At home"}`,
                })
              }
            >
              Start
            </button>
          </div>
        </article>
      )}

      {!library ? (
        <ul className="mt-4 divide-y divide-border overflow-hidden rounded-3xl bg-card">
          {plan.moves.map((move) => (
            <li key={move.id} className="flex items-center gap-3 px-4 py-3">
              <span className="w-12 shrink-0 text-sm font-semibold tabular-nums">40s</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{move.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{move.steps[0]}</span>
              </span>
              <img src={move.image} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        The timer follows the real move photo. It is not a filmed class.
      </p>

      {player ? (
        <FollowAlong
          title={player.title}
          moves={player.moves}
          rounds={player.rounds}
          planned={player.planned}
          onClose={() => setPlayer(null)}
          onDone={(mins, avgHr) => {
            addWorkout({ date: today, kind: "class", minutes: mins, ...(avgHr ? { avgHr } : {}) });
            toast(`${mins} min at home. Calories moved.`);
            setPlayer(null);
          }}
        />
      ) : null}
    </div>
  );
}

function FollowAlong({
  title,
  moves,
  rounds,
  planned,
  onClose,
  onDone,
}: {
  title: string;
  moves: Exercise[];
  rounds: number;
  planned: number;
  onClose: () => void;
  onDone: (minutes: number, avgHr?: number) => void;
}) {
  const age = useSpoonful((s) => s.body.age);
  const spo2 = useSpoonful((s) => s.healthByDate[isoDate()]?.spo2 ?? 0);
  const heart = useHeartSession(age, spo2);
  const seq = useMemo(() => buildSequence(moves, rounds), [moves, rounds]);
  const [step, setStep] = useState(0);
  const [left, setLeft] = useState(WORK_SEC);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const started = useRef(Date.now());
  const guard = useRef(false);
  const boosted = useRef(false);
  const skipRef = useRef(false);
  const bpmRef = useRef(0);
  const avgRef = useRef(heart.avgHr);
  skipRef.current = heart.override;
  bpmRef.current = heart.bpm;
  avgRef.current = heart.avgHr;
  const current = seq[step];
  const still = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const src = !current ? "" : still || !current.move.gif ? current.move.image : current.move.gif;

  useEffect(() => {
    boosted.current = false;
  }, [step]);

  useEffect(() => {
    if (paused || finished) return;
    const id = window.setInterval(() => setLeft((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => window.clearInterval(id);
  }, [paused, finished, step]);

  useEffect(() => {
    if (left > 0) {
      guard.current = false;
      return;
    }
    if (guard.current || finished || !current) return;
    if (current.kind === "rest" && !skipRef.current && !boosted.current && heartCall({ bpm: bpmRef.current, age, spo2 }).level === "stop") {
      boosted.current = true;
      setLeft(30);
      return;
    }
    guard.current = true;
    if (step + 1 >= seq.length) {
      setFinished(true);
      onDone(planned, avgRef.current());
      return;
    }
    const next = step + 1;
    setStep(next);
    setLeft(seq[next]!.kind === "work" ? WORK_SEC : REST_SEC);
  }, [left, step, finished, current, seq, onDone, planned, age, spo2]);

  function endEarly() {
    const elapsed = Math.max(5, Math.round((Date.now() - started.current) / 60000));
    onDone(Math.min(planned, elapsed), heart.avgHr());
  }

  function skip() {
    if (current?.kind === "rest") heart.acknowledge();
    if (step + 1 >= seq.length) {
      setFinished(true);
      onDone(planned, heart.avgHr());
      return;
    }
    const next = step + 1;
    setStep(next);
    setLeft(seq[next]!.kind === "work" ? WORK_SEC : REST_SEC);
  }

  if (!current || finished) return null;
  const upcoming = seq.slice(step + 1).find((item) => item.kind === "work")?.move;
  return (
    <div className="follow-along fixed inset-0 z-[60] flex flex-col bg-background text-foreground">
      <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" className="h-11 px-1 text-sm font-semibold" onClick={onClose}>
          Close
        </button>
        <p className="text-sm text-muted-foreground">
          {step + 1} / {seq.length}
        </p>
        <button type="button" className="h-11 px-2 text-sm font-semibold" onClick={() => setPaused((p) => !p)}>
          {paused ? "Resume" : "Pause"}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-4 mt-1 h-1 overflow-hidden rounded-full bg-muted">
          <span className="block h-full bg-primary" style={{ width: `${(step / seq.length) * 100}%` }} />
        </div>
        <p className="px-5 pt-4 text-sm text-muted-foreground">{title}</p>
        <h2 className="px-5 pt-1 font-display text-4xl leading-none">{current.kind === "work" ? current.move.name : "Rest"}</h2>
        <p className="px-5 pt-3 font-display text-7xl tabular-nums leading-none">{Math.max(0, left)}</p>
        <img src={src} alt="" className="mx-5 mt-4 h-40 rounded-3xl bg-card object-cover" />
        <p className="px-5 pt-3 text-sm leading-relaxed text-muted-foreground">
          {current.kind === "work" ? current.move.steps[0] : `Next · ${upcoming?.name ?? "done"}`}
        </p>
        <div className="px-5 pb-4">
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
          />
        </div>
      </div>
      <div className="px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        {!heart.override ? <HeartWarn call={heart.call} onOverride={heart.acknowledge} /> : null}
        <button type="button" className="h-14 w-full rounded-full bg-primary text-base font-semibold text-primary-foreground" onClick={skip}>
          {step + 1 >= seq.length ? "Finish" : current.kind === "rest" && heart.call.level === "stop" ? "Skip rest" : "Next"}
        </button>
        <button type="button" className="mt-2 h-11 w-full text-sm font-semibold text-muted-foreground" onClick={endEarly}>
          End and save the time
        </button>
      </div>
    </div>
  );
}

function buildHome(area: HomeArea, minutes: 15 | 30 | 45): { moves: Exercise[]; rounds: number; about: number } {
  const count = minutes === 15 ? 4 : minutes === 30 ? 6 : 8;
  const rounds = minutes === 15 ? 3 : minutes === 30 ? 4 : 5;
  const want: MuscleId[] | "any" =
    area === "core"
      ? ["abs", "obliques"]
      : area === "legs"
        ? ["quads", "glutes", "hamstrings", "calves"]
        : area === "push"
          ? ["chest", "front-delts", "triceps"]
          : "any";
  const ranked = EXERCISES.filter((exercise) => exercise.equipment === "body weight" && !exercise.isStretch && exercise.steps.length > 0)
    .filter((exercise) => (want === "any" ? exercise.compound >= 2 : exercise.primary.some((muscle) => want.includes(muscle))))
    .sort((a, b) => b.common - a.common || b.compound - a.compound || a.name.localeCompare(b.name));
  const moves: Exercise[] = [];
  const used = new Set<string>();
  for (const exercise of ranked) {
    const key = exercise.primary[0] ?? exercise.id;
    if (area === "full" && used.has(key)) continue;
    used.add(key);
    moves.push(exercise);
    if (moves.length >= count) break;
  }
  if (moves.length < count) {
    for (const exercise of ranked) {
      if (moves.some((move) => move.id === exercise.id)) continue;
      moves.push(exercise);
      if (moves.length >= count) break;
    }
  }
  const about = Math.round((moves.length * rounds * (WORK_SEC + REST_SEC)) / 60);
  return { moves, rounds, about };
}

function buildSequence(moves: Exercise[], rounds: number): { kind: "work" | "rest"; move: Exercise }[] {
  const seq: { kind: "work" | "rest"; move: Exercise }[] = [];
  for (let round = 0; round < rounds; round += 1) {
    moves.forEach((move, index) => {
      seq.push({ kind: "work", move });
      if (index < moves.length - 1 || round < rounds - 1) seq.push({ kind: "rest", move });
    });
  }
  return seq;
}
