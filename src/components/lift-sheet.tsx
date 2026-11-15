import { ArrowLeftRight, Bookmark, ChevronDown, ChevronUp, History, Pause, Play, Plus, Share2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HeartRow, useHeartSession } from "@/components/live-signals";
import { DEFAULT_BODY, kgFromLb, lbFromKg, type GoalKind } from "@/lib/body";
import { EQUIPMENT_FILTER, equipmentLabel, exerciseById, substituteMoves, type Equipment } from "@/lib/exercises";
import { isoDate } from "@/lib/fuel";
import { pushNote } from "@/lib/notify";
import {
  LIFT_MOVES,
  LIFT_TEMPLATES,
  REST_PRESETS,
  beatsPrevious,
  bestEpley,
  displayStep,
  dropLoadKg,
  epley1rm,
  formatElapsed,
  formatRecap,
  ghostSet,
  isUnilateral,
  lastFinishedSession,
  logUnit,
  moveById,
  nextWorkingKg,
  platesPerSide,
  previousLine,
  previousSessionForMove,
  sessionSetCount,
  sessionVolumeKg,
  snapToLoadable,
  stalledAt,
  volumeChangePct,
  warmupLoads,
  warmupReps,
  type LiftLine,
  type LiftSession,
  type LiftSet,
  type Muscle,
  type SessionFeel,
} from "@/lib/lift";
import { prescribeSets, priorDates, proteinHold, repsForChosenWeight } from "@/lib/prescribe";
import { nutritionForDate, useSpoonful } from "@/lib/spoonful-store";
import { recoveryHold } from "@/lib/workout-safety";
import { isPreviewChrome } from "@/lib/preview-chrome";
import { cn } from "@/lib/utils";

function nid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export type LiftSeed = {
  name: string;
  moveIds: string[];
  date?: string;
  /**
   * What the program prescribed for this session, by move. Without it a
   * seeded session opens with a single set of 8 no matter what the plan
   * said, so "4 × 5" on the day card became "1 × 8" the moment you started.
   */
  plan?: { moveId: string; sets: number; reps: string }[];
};

export function LiftSheet({ open, onClose, seed }: { open: boolean; onClose: () => void; seed?: LiftSeed }) {
  const body = useSpoonful((s) => s.body) ?? DEFAULT_BODY;
  const sessions = useSpoonful((s) => s.liftSessions);
  const goal = useSpoonful((s) => s.goal);
  const meals = useSpoonful((s) => s.meals);
  const snacks = useSpoonful((s) => s.snacks);
  const cookedDates = useSpoonful((s) => s.cookedDates);
  const portionMultByDate = useSpoonful((s) => s.portionMultByDate);
  const hold = proteinHold(
    priorDates(isoDate(), 3).map((date) => ({
      eaten: nutritionForDate(meals, date, snacks, portionMultByDate, cookedDates).protein,
      target: goal.protein,
    })),
  );
  const healthToday = useSpoonful((s) => s.healthByDate[isoDate()]);
  const eased = hold || recoveryHold(healthToday);
  const heart = useHeartSession(body.age, healthToday?.spo2 ?? 0);
  const callRef = useRef(heart.call);
  const skipRef = useRef(false);
  callRef.current = heart.call;
  skipRef.current = heart.override;
  const saveLiftSession = useSpoonful((s) => s.saveLiftSession);
  const notifyPrefs = useSpoonful((s) => s.notifyPrefs);
  const favMoves = useSpoonful((s) => s.favMoves);
  const toggleFavMove = useSpoonful((s) => s.toggleFavMove);
  const imperial = body.units !== "metric";
  const [session, setSession] = useState<LiftSession>(() => emptySession());
  const [picker, setPicker] = useState(false);
  const [history, setHistory] = useState(false);
  const [rest, setRest] = useState(0);
  const [restPreset, setRestPreset] = useState(90);
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<"all" | Muscle>("all");
  const [gear, setGear] = useState<Equipment | "all">("all");
  const [savedOnly, setSavedOnly] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [tickOf, setTickOf] = useState<{ lineId: string; setId: string } | null>(null);
  const [swapOf, setSwapOf] = useState<string | null>(null);
  /** Which line has its advanced actions open. Mid-workout the set grid comes first. */
  const [moreOf, setMoreOf] = useState<string | null>(null);
  const [restHold, setRestHold] = useState(false);
  const [restMove, setRestMove] = useState<string | null>(null);
  const restWas = useRef(0);
  const skipChime = useRef(false);
  const restBoosted = useRef(false);

  useEffect(() => {
    if (!open) return;
    setSession(
      seed?.moveIds.length
        ? sessionFromSeed(seed, sessions, body.weightKg, imperial, body.goalKind, eased)
        : emptySession(),
    );
    setRest(0);
    setRestHold(false);
    setRestMove(null);
    setPicker(false);
    setHistory(false);
    setQuery("");
    setTickOf(null);
  }, [open, seed?.name, seed?.date, seed?.moveIds?.join(",")]);

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (rest <= 0 || restHold) return;
    const id = window.setInterval(() => {
      setRest((n) => {
        if (n <= 1) {
          const call = callRef.current;
          if (call.level === "stop" && !skipRef.current && !restBoosted.current) {
            restBoosted.current = true;
            return 30;
          }
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [rest, restHold]);

  useEffect(() => {
    if (restWas.current === 0 && rest > 0) restBoosted.current = false;
    if (restWas.current > 0 && rest === 0) {
      const skipped = skipChime.current;
      skipChime.current = false;
      if (!skipped) {
        try {
          window.navigator.vibrate?.([40, 40, 80]);
        } catch {
          /* ignore */
        }
        try {
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = 880;
          osc.connect(gain);
          gain.connect(ctx.destination);
          gain.gain.setValueAtTime(0.0001, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
          osc.start();
          osc.stop(ctx.currentTime + 0.3);
        } catch {
          /* ignore */
        }
        toast("Rest's up");
        if (notifyPrefs.rest) {
          const move = restMove ? moveById(restMove)?.name : undefined;
          pushNote("Rest's up", move ? `Back to ${move}` : "Next set is ready");
        }
      }
    }
    restWas.current = rest;
  }, [rest, notifyPrefs.rest, restMove]);

  useEffect(() => {
    if (!open || !tickOf) return;
    const id = window.setInterval(() => {
      setSession((cur) => ({
        ...cur,
        lines: cur.lines.map((l) =>
          l.id !== tickOf.lineId
            ? l
            : {
                ...l,
                sets: l.sets.map((s) => (s.id !== tickOf.setId ? s : { ...s, reps: s.reps + 1 })),
              },
        ),
      }));
    }, 1000);
    return () => window.clearInterval(id);
  }, [open, tickOf]);

  useEffect(() => {
    if (!open) return;
    let lock: WakeLockSentinel | undefined;
    const request = () => {
      void navigator.wakeLock
        ?.request("screen")
        .then((s) => {
          lock = s;
        })
        .catch(() => {
          /* unsupported or denied */
        });
    };
    request();
    const onVis = () => {
      if (document.visibilityState === "visible") request();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release();
    };
  }, [open]);

  const volume = useMemo(() => sessionVolumeKg(session), [session]);
  const volumeDisp = imperial ? Math.round(lbFromKg(volume)) : Math.round(volume);
  const lastSession = useMemo(() => lastFinishedSession(sessions, session.id), [sessions, session.id]);
  const volDelta = useMemo(() => volumeChangePct(session, lastSession), [session, lastSession]);
  const setProgress = useMemo(() => {
    let done = 0;
    let total = 0;
    for (const line of session.lines) {
      for (const s of line.sets) {
        if (s.warmup) continue;
        total += 1;
        if (s.done) done += 1;
      }
    }
    return { done, total };
  }, [session]);
  const etaMin = useMemo(() => {
    let sec = 0;
    for (const line of session.lines) {
      const left = line.sets.filter((s) => !s.done && !s.warmup).length;
      if (!left) continue;
      sec += left * (20 + (exerciseById(line.moveId)?.restSec ?? restPreset));
    }
    return sec > 0 ? Math.max(1, Math.round(sec / 60)) : 0;
  }, [session, restPreset]);
  /** What today's plan asked for on this move, so the goal stays visible while logging. */
  const targetFor = (moveId: string) => seed?.plan?.find((p) => p.moveId === moveId);
  const moves = useMemo(() => {
    const q = query.trim().toLowerCase();
    return LIFT_MOVES.filter((m) => {
      if (savedOnly && !favMoves.includes(m.id)) return false;
      if (muscle !== "all" && m.muscle !== muscle) return false;
      if (gear !== "all" && exerciseById(m.id)?.equipment !== gear) return false;
      if (!q) return true;
      return m.name.toLowerCase().includes(q) || m.muscle.includes(q);
    });
  }, [query, muscle, gear, savedOnly, favMoves]);

  if (!open) return null;

  function addMove(moveId: string) {
    const move = moveById(moveId);
    const planned = seed?.plan?.find((p) => p.moveId === moveId);
    const prescribed = prescribeSets({
      moveId,
      sessions,
      bodyKg: body.weightKg,
      imperial,
      goalKind: body.goalKind,
      hold: eased,
      planned,
    });
    const sets: LiftSet[] = prescribed.map((set) => ({
      id: nid(),
      reps: set.reps,
      weightKg: set.weightKg,
      done: false,
      warmup: set.warmup,
    }));
    const work = prescribed.find((set) => !set.warmup);
    if (stalledAt(sessions, moveId) && work) {
      const shown = imperial ? Math.round(lbFromKg(work.weightKg)) : Math.round(work.weightKg);
      toast(`Two grinding sessions at that weight — opening at ${shown}`);
    }
    setSession((cur) => ({
      ...cur,
      name: cur.lines.length === 0 ? (move?.name ?? "Lift") : cur.name,
      lines: [...cur.lines, { id: nid(), moveId, sets, note: previousLine(sessions, moveId)?.note }],
    }));
    setPicker(false);
    setQuery("");
  }

  function repeatLast() {
    const last = lastFinishedSession(sessions);
    if (!last) {
      toast("No session to copy yet");
      return;
    }
    setSession(sessionFromSeed({ name: last.name, moveIds: last.lines.map((l) => l.moveId) }, sessions, body.weightKg, imperial, body.goalKind, eased));
    toast(`Copied ${last.name}`);
  }

  function applyTemplate(id: string) {
    const tpl = LIFT_TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    setSession((cur) => {
      const next = { ...cur, name: tpl.name, lines: [...cur.lines] };
      for (const moveId of tpl.moves) {
        if (next.lines.some((l) => l.moveId === moveId)) continue;
        const prescribed = prescribeSets({
          moveId,
          sessions,
          bodyKg: body.weightKg,
          imperial,
          goalKind: body.goalKind,
          hold: eased,
        });
        next.lines.push({
          id: nid(),
          moveId,
          sets: prescribed.map((set) => ({
            id: nid(),
            reps: set.reps,
            weightKg: set.weightKg,
            done: false,
            warmup: set.warmup,
          })),
        });
      }
      return next;
    });
    setPicker(false);
  }

  function patchSet(lineId: string, setId: string, patch: Partial<LiftSet>) {
    setSession((cur) => ({
      ...cur,
      lines: cur.lines.map((l) =>
        l.id !== lineId ? l : { ...l, sets: l.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) },
      ),
    }));
  }

  function addSet(line: LiftLine, warmup = false) {
    const last = line.sets.filter((s) => (warmup ? s.warmup : !s.warmup)).at(-1) ?? line.sets.at(-1);
    const side =
      !warmup && isUnilateral(line.moveId) ? (last?.side === "L" ? "R" : "L") : last?.side;
    setSession((cur) => ({
      ...cur,
      lines: cur.lines.map((l) =>
        l.id !== line.id
          ? l
          : {
              ...l,
              sets: [
                ...l.sets,
                {
                  id: nid(),
                  reps: last?.reps ?? 8,
                  weightKg: warmup ? (last?.weightKg ?? 40) * 0.5 : (last?.weightKg ?? 40),
                  done: false,
                  warmup,
                  side,
                },
              ],
            },
      ),
    }));
  }

  function addLadder(line: LiftLine) {
    const work = line.sets.find((s) => !s.warmup);
    const kg = work?.weightKg ?? 40;
    const reps = work?.reps ?? 5;
    const loads = warmupLoads(kg);
    const reps3 = warmupReps(reps);
    const onBar = moveById(line.moveId)?.bar === true;
    setSession((cur) => ({
      ...cur,
      lines: cur.lines.map((l) =>
        l.id !== line.id
          ? l
          : {
              ...l,
              sets: [
                ...loads.map((weightKg, i) => ({
                  id: nid(),
                  reps: reps3[i] ?? reps,
                  weightKg: onBar ? snapToLoadable(weightKg, imperial) : weightKg,
                  done: false,
                  warmup: true as const,
                })),
                ...l.sets.filter((s) => !s.warmup),
              ],
            },
      ),
    }));
  }

  function fillRest(line: LiftLine) {
    const last = line.sets.filter((s) => s.done && !s.warmup).at(-1);
    if (!last) {
      toast("Log a set first");
      return;
    }
    setSession((cur) => ({
      ...cur,
      lines: cur.lines.map((l) =>
        l.id !== line.id
          ? l
          : {
              ...l,
              sets: l.sets.map((s) =>
                s.done || s.warmup ? s : { ...s, reps: last.reps, weightKg: last.weightKg },
              ),
            },
      ),
    }));
  }

  function moveLine(lineId: string, dir: -1 | 1) {
    setSession((cur) => {
      const i = cur.lines.findIndex((l) => l.id === lineId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cur.lines.length) return cur;
      const lines = [...cur.lines];
      const [row] = lines.splice(i, 1);
      lines.splice(j, 0, row!);
      return { ...cur, lines };
    });
  }

  function swapMoveOnLine(lineId: string, toId: string) {
    const prev = previousLine(sessions, toId);
    setSession((cur) => ({
      ...cur,
      lines: cur.lines.map((l) =>
        l.id !== lineId
          ? l
          : {
              ...l,
              moveId: toId,
              note: prev?.note ?? l.note,
              sets: l.sets.map((s, i) => ({
                ...s,
                weightKg: prev?.sets[i]?.weightKg ?? s.weightKg,
                reps: prev?.sets[i]?.reps ?? s.reps,
                done: false,
              })),
            },
      ),
    }));
    setSwapOf(null);
  }

  function addDrop(line: LiftLine) {
    const last = line.sets.filter((s) => s.done && !s.warmup).at(-1) ?? line.sets.filter((s) => !s.warmup).at(-1);
    if (!last) {
      toast("Log a set first");
      return;
    }
    setSession((cur) => ({
      ...cur,
      lines: cur.lines.map((l) =>
        l.id !== line.id
          ? l
          : {
              ...l,
              sets: [
                ...l.sets,
                {
                  id: nid(),
                  reps: last.reps,
                  weightKg: dropLoadKg(last.weightKg),
                  done: false,
                  kind: "drop" as const,
                },
              ],
            },
      ),
    }));
  }

  function markLastKind(line: LiftLine, kind: "amrap" | "fail") {
    const last = [...line.sets].reverse().find((s) => s.done && !s.warmup);
    if (!last) {
      toast("Log a set first");
      return;
    }
    const next = last.kind === kind ? "work" : kind;
    patchSet(line.id, last.id, { kind: next });
    toast(next === "amrap" ? "Marked all out" : next === "fail" ? "Marked missed reps" : "Back to a normal set");
  }

  function restPause(line: LiftLine) {
    const last = line.sets.filter((s) => s.done && !s.warmup).at(-1);
    if (!last) {
      toast("Log a set first");
      return;
    }
    const open = line.sets.some((s) => !s.done && !s.warmup);
    if (!open) addSet(line);
    setRestHold(false);
    setRestMove(line.moveId);
    setRest(15);
    toast("15s rest-pause");
  }

  async function copyRecap() {
    const text = formatRecap({ ...session, finishedAt: session.finishedAt ?? Date.now() }, imperial);
    try {
      await navigator.clipboard.writeText(text);
      toast("Recap copied");
    } catch {
      toast(text);
    }
  }

  function applyLoad(lineId: string, setId: string, weightKg: number) {
    setSession((cur) => ({
      ...cur,
      lines: cur.lines.map((line) => {
        if (line.id !== lineId) return line;
        return {
          ...line,
          sets: line.sets.map((set) => {
            if (set.id !== setId) return set;
            const next = { ...set, weightKg: Math.max(0, weightKg) };
            if (set.warmup || set.done) return next;
            const reps = repsForChosenWeight({
              moveId: line.moveId,
              weightKg: next.weightKg,
              sessions,
              goalKind: body.goalKind,
              plannedReps: targetFor(line.moveId)?.reps,
              exceptId: cur.id,
            });
            return reps == null ? next : { ...next, reps };
          }),
        };
      }),
    }));
  }

  function bumpWeight(lineId: string, setId: string, dir: 1 | -1) {
    const step = imperial ? kgFromLb(displayStep(true)) : displayStep(false);
    const line = session.lines.find((item) => item.id === lineId);
    const set = line?.sets.find((item) => item.id === setId);
    if (!set) return;
    applyLoad(lineId, setId, Math.round((set.weightKg + dir * step) * 4) / 4);
  }

  function logSet(line: LiftLine, set: LiftSet) {
    if (tickOf?.setId === set.id) setTickOf(null);
    const nextDone = !set.done;
    patchSet(line.id, set.id, { done: nextDone });
    if (!nextDone) return;
    const partner = line.pairId ? session.lines.find((l) => l.pairId === line.pairId && l.id !== line.id) : undefined;
    const idx = line.sets.findIndex((s) => s.id === set.id);
    const partnerReady = !partner || Boolean(partner.sets[idx]?.done) || set.warmup;
    if (!partnerReady) {
      toast("Hit the paired move");
      return;
    }
    const restSec = exerciseById(line.moveId)?.restSec ?? restPreset;
    setRestHold(false);
    setRestMove(line.moveId);
    setRest(set.warmup ? Math.min(60, restSec) : restSec);
    try {
      window.navigator.vibrate?.(40);
    } catch {
      /* ignore */
    }
    const leftover = line.sets.filter((s) => !s.warmup && s.id !== set.id && !s.done);
    if (leftover.length === 0) {
      const idx = session.lines.findIndex((l) => l.id === line.id);
      const next = session.lines[idx + 1];
      if (next) {
        window.requestAnimationFrame(() => {
          document.getElementById(`lift-line-${next.id}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
        });
      }
    }
  }

  function setFeel(feel: SessionFeel) {
    setSession((cur) => ({ ...cur, feel: cur.feel === feel ? undefined : feel }));
  }

  function startHold(line: LiftLine, set: LiftSet) {
    if (tickOf?.setId === set.id) {
      setTickOf(null);
      return;
    }
    patchSet(line.id, set.id, { reps: 0, done: false });
    setTickOf({ lineId: line.id, setId: set.id });
  }

  function pairLine(line: LiftLine) {
    const idx = session.lines.findIndex((l) => l.id === line.id);
    const next = session.lines[idx + 1];
    if (!next) {
      toast("Add the next exercise, then pair");
      return;
    }
    const pid = line.pairId ?? nid();
    setSession((cur) => ({
      ...cur,
      lines: cur.lines.map((l) => (l.id === line.id || l.id === next.id ? { ...l, pairId: pid } : l)),
    }));
  }

  function finish() {
    if (sessionVolumeKg(session) <= 0) {
      toast("Log a working set first");
      return;
    }
    const prs = session.lines.filter((line) => {
      const best = bestEpley(sessions, line.moveId);
      return line.sets.some((s) => s.done && !s.warmup && epley1rm(s.weightKg, s.reps) > best && best > 0);
    });
    saveLiftSession({ ...session, finishedAt: Date.now() });
    toast(
      prs.length
        ? `PR on ${prs.map((l) => moveById(l.moveId)?.name ?? l.moveId).join(", ")} — Fuel updated`
        : "Lift saved — Fuel updated live",
    );
    onClose();
  }

  return (
    <div
      className="lift-deck fixed inset-0 z-50 flex max-w-full flex-col overflow-x-hidden bg-background text-foreground"
      role="dialog"
      aria-modal="true"
      aria-label="Workout"
    >
      <header className="pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-stretch">
          <div className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2">
            <Button variant="ghost" size="icon" className="shrink-0" onClick={onClose} aria-label="Close lift">
              <X />
            </Button>
            <div className="min-w-0 text-center">
              <p className="truncate text-xs text-muted-foreground">
                {formatElapsed(now - session.startedAt)}
                {setProgress.total > 0 ? ` · ${setProgress.done} of ${setProgress.total}` : ""}
                {etaMin > 0 ? ` · about ${etaMin} min left` : ""}
              </p>
              <p className="font-display text-3xl tabular-nums leading-none">
                {volumeDisp}
                <span className="ml-1 font-sans text-sm font-medium text-muted-foreground">
                  {imperial ? "lb" : "kg"} lifted
                  {volDelta != null && volume > 0
                    ? ` ${volDelta > 0 ? "↑" : volDelta < 0 ? "↓" : ""}${volDelta === 0 ? "same" : `${Math.abs(volDelta)}%`}`
                    : ""}
                </span>
              </p>
            </div>
            <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setHistory(true)} aria-label="History">
              <History />
            </Button>
          </div>
          {isPreviewChrome() ? <div className="pill-slot" aria-hidden /> : null}
        </div>
        <div className="px-4 pb-1">
          <div className="flex gap-2">
            <Button variant="spark" className="lift-finish min-w-0 flex-1" onClick={finish}>
              Finish
            </Button>
            <Button variant="secondary" size="icon" className="shrink-0" onClick={() => void copyRecap()} aria-label="Copy recap">
              <Share2 />
            </Button>
          </div>
          {session.lines.some((l) => l.sets.some((s) => s.done && !s.warmup)) ? (
            <div className="mt-2 flex gap-1">
              {(["easy", "right", "grind"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFeel(id)}
                  className={cn(
                    "lift-feel h-11 flex-1 text-sm capitalize",
                    session.feel === id ? "bg-spark text-spark-foreground" : "bg-card shadow-[var(--shadow-border)]",
                  )}
                >
                  {id === "right" ? "On it" : id}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      {rest > 0 ? (
        <div className="lift-rest-bar relative z-10 mx-4 mt-3 shrink-0 bg-card px-3 py-3 text-foreground">
          <p className="text-xs font-medium text-muted-foreground">{restHold ? "Rest paused" : "Rest"}</p>
          <p className="mt-1 font-display text-4xl tabular-nums leading-none">{rest}s</p>
          {restMove ? (
            <p className="mt-1 truncate text-sm text-muted-foreground">{moveById(restMove)?.name}</p>
          ) : null}
          <div className="mt-3 grid grid-cols-4 gap-2">
            <button type="button" className="lift-rest h-11 text-sm font-medium" onClick={() => setRest((n) => Math.max(0, n - 15))}>
              −15
            </button>
            <button
              type="button"
              className="lift-rest flex h-11 items-center justify-center"
              onClick={() => setRestHold((h) => !h)}
              aria-label={restHold ? "Resume rest" : "Pause rest"}
            >
              {restHold ? <Play className="size-4" /> : <Pause className="size-4" />}
            </button>
            <button
              type="button"
              className="lift-rest h-11 text-sm font-medium"
              onClick={() => {
                skipChime.current = true;
                heart.acknowledge();
                setRestHold(false);
                setRest(0);
              }}
            >
              {heart.call.level === "stop" ? "Skip anyway" : "Skip"}
            </button>
            <button type="button" className="lift-rest h-11 text-sm font-medium" onClick={() => setRest((n) => n + 15)}>
              +15
            </button>
          </div>
        </div>
      ) : (
        <div className="chip-row mx-4 mt-3">
          {REST_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRestPreset(n)}
              className={cn(
                "lift-chip h-11 shrink-0 px-3 text-sm",
                restPreset === n ? "bg-spark text-spark-foreground" : "bg-card shadow-[var(--shadow-border)]",
              )}
            >
              {n}s rest
            </button>
          ))}
        </div>
      )}

      <div className="mx-4 mt-2">
        <HeartRow
          age={body.age}
          bpm={heart.bpm}
          spo2={healthToday?.spo2}
          state={heart.state}
          onConnect={() => void heart.connect()}
          onType={heart.setBpm}
          override={heart.override}
          onOverride={heart.acknowledge}
        />
      </div>

      <div className="relative z-0 min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 pb-28">
        {session.lines.length === 0 ? (
          <section className="mb-4">
            <h2 className="font-display text-xl">Start with a template</h2>
            <p className="mt-1 text-sm text-muted-foreground">Loads last weights when you have them.</p>
            {sessions.some((s) => s.lines.some((l) => l.sets.some((x) => x.done))) ? (
              <Button variant="secondary" className="mt-3 w-full" onClick={repeatLast}>
                Repeat last session
              </Button>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
              {LIFT_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t.id)}
                  className="rounded-3xl bg-card px-4 py-3 text-left shadow-[var(--shadow-border)]"
                >
                  <p className="font-medium">{t.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t.hint}</p>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {session.lines.map((line) => {
          const move = moveById(line.moveId);
          const ex = exerciseById(line.moveId);
          const prev = previousLine(sessions, line.moveId, session.id);
          const prevSess = previousSessionForMove(sessions, line.moveId, session.id);
          const best = bestEpley(sessions, line.moveId);
          const unit = logUnit(line.moveId);
          const stalled = stalledAt(sessions, line.moveId, session.id);
          const nextKg = nextWorkingKg(sessions, line.moveId, prev, prevSess?.feel, session.id);
          const paired = line.pairId ? session.lines.find((l) => l.pairId === line.pairId && l.id !== line.id) : undefined;
          return (
            <section key={line.id} id={`lift-line-${line.id}`} className="lift-card mb-4 min-w-0 overflow-x-hidden p-4">
              <div className="min-w-0">
                <h2 className="font-display text-2xl leading-tight">{move?.name ?? line.moveId}</h2>
                {targetFor(line.moveId) ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Aim for {targetFor(line.moveId)!.sets} sets of {targetFor(line.moveId)!.reps}
                  </p>
                ) : null}
                {ex?.steps?.[0] ? <p className="mt-1 text-sm leading-snug text-muted-foreground">{ex.steps[0]}</p> : null}
                {paired ? (
                  <p className="mt-1 text-xs font-medium text-spark">Back to back with {moveById(paired.moveId)?.name}</p>
                ) : null}
                {prev ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Last time{" "}
                    {prev.sets
                      .filter((s) => s.done && !s.warmup)
                      .slice(-3)
                      .map((s) => {
                        const w = imperial ? Math.round(lbFromKg(s.weightKg)) : Math.round(s.weightKg);
                        return `${s.reps} × ${w}`;
                      })
                      .join(", ")}
                    {nextKg && nextKg !== prev.sets.filter((s) => s.done && !s.warmup).at(-1)?.weightKg
                      ? ` · ${stalled ? "try a little less" : "try"} ${imperial ? Math.round(lbFromKg(nextKg)) : nextKg}`
                      : ""}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">First time. Log the weight that felt solid.</p>
                )}
              </div>
              <ul className="mt-3 space-y-2">
                <li className="grid grid-cols-[1.25rem_4.25rem_minmax(0,1fr)_4.25rem] gap-1 text-xs text-muted-foreground">
                  <span />
                  <span className="text-center">{unit === "sec" ? "Sec" : unit === "m" ? "Meters" : "Reps"}</span>
                  <span className="text-center">{imperial ? "Pounds" : "Kilograms"}</span>
                  <span />
                </li>
                {line.sets.map((set, i) => {
                  const shown = imperial ? Math.round(lbFromKg(set.weightKg)) : Math.round(set.weightKg * 10) / 10;
                  const est = epley1rm(set.weightKg, set.reps);
                  const isPr = Boolean(set.done && !set.warmup && best > 0 && est > best);
                  const workIndex = line.sets.filter((s, j) => j < i && !s.warmup).length;
                  const ghost = set.warmup ? undefined : ghostSet(prev, workIndex);
                  const beat = !set.warmup && beatsPrevious(set, prev, workIndex);
                  const ticking = tickOf?.setId === set.id;
                  return (
                    <li key={set.id}>
                      <div className="grid min-w-0 grid-cols-[1.25rem_4.25rem_minmax(0,1fr)_4.25rem] items-center gap-1">
                        <span className="text-center text-xs tabular-nums text-muted-foreground">
                          {set.warmup ? "W" : set.kind === "drop" ? "D" : set.kind === "fail" ? "F" : set.kind === "amrap" ? "A" : workIndex + 1}
                        </span>
                        {unit === "sec" ? (
                          <button
                            type="button"
                            className={cn(
                              "lift-reps h-12 px-1 text-center text-sm tabular-nums",
                              ticking ? "bg-spark text-spark-foreground" : "bg-background shadow-[var(--shadow-border)]",
                            )}
                            onClick={() => startHold(line, set)}
                            aria-label={ticking ? "Stop timer" : "Start timer"}
                          >
                            {ticking ? set.reps : set.reps || "Go"}
                          </button>
                        ) : (
                          <Input
                            className="lift-reps h-12 px-1 text-center tabular-nums"
                            inputMode="numeric"
                            value={String(set.reps)}
                            onChange={(e) => patchSet(line.id, set.id, { reps: Number(e.target.value) || 0 })}
                            aria-label={unit === "m" ? "Meters" : "Reps"}
                          />
                        )}
                        <div className="flex min-w-0 items-center">
                          <button
                            type="button"
                            className="lift-qty lift-qty-minus flex h-12 w-8 shrink-0 items-center justify-center bg-background text-lg leading-none"
                            onClick={() => bumpWeight(line.id, set.id, -1)}
                            aria-label="Decrease weight"
                          >
                            −
                          </button>
                          <Input
                            className="h-12 min-w-0 rounded-none px-0.5 text-center tabular-nums shadow-none"
                            inputMode="decimal"
                            value={String(shown)}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              applyLoad(line.id, set.id, imperial ? kgFromLb(n || 0) : n || 0);
                            }}
                            aria-label={imperial ? "Pounds" : "Kilograms"}
                          />
                          <button
                            type="button"
                            className="lift-qty lift-qty-plus flex h-12 w-8 shrink-0 items-center justify-center bg-background text-lg leading-none"
                            onClick={() => bumpWeight(line.id, set.id, 1)}
                            aria-label="Increase weight"
                          >
                            +
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => logSet(line, set)}
                          className={cn(
                            "lift-log h-12 min-w-0 px-1 text-sm font-medium",
                            set.done
                              ? "bg-primary text-primary-foreground"
                              : beat
                                ? "bg-spark text-spark-foreground"
                                : "bg-background shadow-[var(--shadow-border)]",
                          )}
                        >
                          {set.done ? (isPr ? "PR" : "Done") : "Log"}
                        </button>
                      </div>
                      {ghost && !set.done ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Last time {ghost.reps} {unit === "sec" ? "sec" : unit === "m" ? "m" : "reps"} at{" "}
                          {imperial ? Math.round(lbFromKg(ghost.weightKg)) : Math.round(ghost.weightKg * 10) / 10}
                          {imperial ? " lb" : " kg"}
                          {ghost.rir != null ? ` · ${ghost.rir} reps left` : ""}
                        </p>
                      ) : null}
                      {isUnilateral(line.moveId) ? (
                        <div className="mt-1 flex items-center gap-1 pl-8">
                          {(["L", "R"] as const).map((side) => (
                            <button
                              key={side}
                              type="button"
                              onClick={() => patchSet(line.id, set.id, { side })}
                              className={cn(
                                "lift-chip h-8 min-w-8 px-2 text-xs font-medium",
                                set.side === side ? "bg-spark text-spark-foreground" : "bg-background shadow-[var(--shadow-border)]",
                              )}
                            >
                              {side}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {set.done && !set.warmup ? (
                        <div className="mt-2">
                          <p className="text-xs text-muted-foreground">Reps you still had</p>
                          <div className="mt-1 grid grid-cols-5 gap-1">
                            {[4, 3, 2, 1, 0].map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => patchSet(line.id, set.id, { rir: n })}
                                className={cn(
                                  "lift-chip h-11 text-sm tabular-nums",
                                  set.rir === n ? "bg-spark text-spark-foreground" : "bg-background",
                                )}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">4 was easy. 0 means nothing left.</p>
                        </div>
                      ) : null}
                      {set.kind === "drop" || set.kind === "fail" || set.kind === "amrap" ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {set.kind === "drop" ? "Lighter set" : set.kind === "fail" ? "Missed reps" : "All out"}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {move?.bar ? (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Plates each side{" "}
                  {platesPerSide(
                    Math.max(0, ...line.sets.filter((s) => !s.warmup).map((s) => s.weightKg)),
                    imperial,
                  )
                    .map((p) => `${p.count}×${p.plate}`)
                    .join(" + ") || "bar only"}
                </p>
              ) : null}
              {line.sets.some((s) => s.done && !s.warmup && s.reps > 1) ? (
                <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                  Estimated max{" "}
                  {imperial
                    ? Math.round(lbFromKg(Math.max(...line.sets.filter((s) => s.done && !s.warmup).map((s) => epley1rm(s.weightKg, s.reps)))))
                    : Math.round(Math.max(...line.sets.filter((s) => s.done && !s.warmup).map((s) => epley1rm(s.weightKg, s.reps))))}{" "}
                  {imperial ? "lb" : "kg"}
                  {best > 0 ? ` · best ${imperial ? Math.round(lbFromKg(best)) : Math.round(best)}` : ""}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button variant="ghost" onClick={() => addSet(line)}>
                  <Plus /> Add set
                </Button>
                <Button variant="ghost" onClick={() => moveLine(line.id, -1)} aria-label="Move exercise up">
                  <ChevronUp />
                </Button>
                <Button variant="ghost" onClick={() => moveLine(line.id, 1)} aria-label="Move exercise down">
                  <ChevronDown />
                </Button>
                <Button variant="ghost" onClick={() => addLadder(line)}>
                  Warm-up
                </Button>
                <Button variant="ghost" onClick={() => setSwapOf(swapOf === line.id ? null : line.id)}>
                  <ArrowLeftRight /> Swap
                </Button>
                <Button
                  variant="ghost"
                  className="ml-auto text-muted-foreground"
                  aria-expanded={moreOf === line.id}
                  onClick={() => setMoreOf(moreOf === line.id ? null : line.id)}
                >
                  {moreOf === line.id ? "Less" : "More"}
                </Button>
              </div>
              {moreOf === line.id ? (
                <>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => pairLine(line)}>
                      Back to back
                    </Button>
                    <Button variant="ghost" onClick={() => fillRest(line)}>
                      Copy last set
                    </Button>
                    <Button variant="ghost" onClick={() => addDrop(line)}>
                      Lighter set
                    </Button>
                    <Button variant="ghost" onClick={() => restPause(line)}>
                      Short rest
                    </Button>
                    <Button variant="ghost" onClick={() => markLastKind(line, "amrap")}>
                      All out
                    </Button>
                    <Button variant="ghost" onClick={() => markLastKind(line, "fail")}>
                      Missed reps
                    </Button>
                  </div>
                  <Input
                    className="mt-2 h-11"
                    value={line.note ?? ""}
                    placeholder="Note for next time"
                    onChange={(e) =>
                      setSession((cur) => ({
                        ...cur,
                        lines: cur.lines.map((l) => (l.id === line.id ? { ...l, note: e.target.value } : l)),
                      }))
                    }
                  />
                </>
              ) : line.note ? (
                <p className="mt-2 text-xs italic text-muted-foreground">{line.note}</p>
              ) : null}
              {swapOf === line.id ? (
                <div className="mt-2 grid grid-cols-2 gap-1">
                  {substituteMoves(line.moveId, 6).map((alt) => (
                    <button
                      key={alt.id}
                      type="button"
                      onClick={() => swapMoveOnLine(line.id, alt.id)}
                      className="rounded-2xl bg-background px-3 py-2 text-left text-sm shadow-[var(--shadow-border)]"
                    >
                      {alt.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
        <Button variant="secondary" className="w-full" onClick={() => setPicker(true)}>
          <Plus /> Add exercise
        </Button>
      </div>

      {picker ? (
        <div className="absolute inset-0 z-10 flex flex-col bg-background/95 pt-14">
          <div className="flex items-stretch">
            <div className="min-w-0 flex-1 px-4">
              <Button variant="ghost" className="mb-3" onClick={() => setPicker(false)}>
                Close
              </Button>
            </div>
            {isPreviewChrome() ? <div className="pill-slot" aria-hidden /> : null}
          </div>
          <div className="px-4">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Squat, bench, pull-up…" />
            <div className="chip-row mt-2 pb-1">
              <button
                type="button"
                onClick={() => setSavedOnly((v) => !v)}
                className={cn(
                  "lift-chip flex h-11 shrink-0 items-center gap-1.5 px-3 text-sm",
                  savedOnly ? "bg-spark text-spark-foreground" : "bg-card shadow-[var(--shadow-border)]",
                )}
              >
                <Bookmark className="size-3.5" /> Saved
              </button>
              {(["all", "legs", "push", "pull", "core", "full"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMuscle(id)}
                  className={cn(
                    "lift-chip h-11 shrink-0 px-3 text-sm capitalize",
                    muscle === id ? "bg-spark text-spark-foreground" : "bg-card shadow-[var(--shadow-border)]",
                  )}
                >
                  {id}
                </button>
              ))}
            </div>
            <div className="chip-row mt-2 pb-1">
              <button
                type="button"
                onClick={() => setGear("all")}
                className={cn(
                  "lift-chip h-11 shrink-0 px-3 text-sm",
                  gear === "all" ? "bg-primary text-primary-foreground" : "bg-card shadow-[var(--shadow-border)]",
                )}
              >
                Any kit
              </button>
              {EQUIPMENT_FILTER.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setGear(id)}
                  className={cn(
                    "lift-chip h-11 shrink-0 px-3 text-sm",
                    gear === id ? "bg-primary text-primary-foreground" : "bg-card shadow-[var(--shadow-border)]",
                  )}
                >
                  {equipmentLabel(id)}
                </button>
              ))}
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-4 py-3 pb-10">
            {session.lines.length === 0
              ? LIFT_TEMPLATES.map((t) => (
                  <li key={t.id} className="mb-1">
                    <button
                      type="button"
                      className="flex min-h-12 w-full items-center justify-between rounded-2xl bg-spark/15 px-4 text-left text-sm"
                      onClick={() => applyTemplate(t.id)}
                    >
                      {t.name}
                      <span className="text-xs text-muted-foreground">{t.hint}</span>
                    </button>
                  </li>
                ))
              : null}
            {moves.map((m) => (
              <li key={m.id} className="flex min-h-12 items-stretch gap-1 rounded-2xl bg-card pr-1 shadow-[var(--shadow-border)]">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 px-4 text-left text-sm"
                  onClick={() => addMove(m.id)}
                >
                  <span className="truncate">{m.name}</span>
                  <span className="shrink-0 text-xs capitalize text-muted-foreground">{m.muscle}</span>
                </button>
                <button
                  type="button"
                  className="flex w-10 shrink-0 items-center justify-center"
                  aria-label={favMoves.includes(m.id) ? `Remove ${m.name} from favorites` : `Save ${m.name}`}
                  onClick={() => toggleFavMove(m.id)}
                >
                  <Bookmark className={cn("size-3.5", favMoves.includes(m.id) ? "fill-current text-spark" : "text-muted-foreground")} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {history ? (
        <div className="absolute inset-0 z-10 overflow-y-auto bg-background/95 px-4 pt-14 pb-10">
          <Button variant="ghost" className="mb-3" onClick={() => setHistory(false)}>
            Close
          </Button>
          <h2 className="font-display text-2xl">History</h2>
          {sessions.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No sessions yet. Finish one and it lands here.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {[...sessions].reverse().slice(0, 12).map((s) => {
                const vol = sessionVolumeKg(s);
                return (
                  <li key={s.id} className="rounded-2xl bg-card px-4 py-3 shadow-[var(--shadow-border)]">
                    <p className="font-medium">{s.name}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                      {s.date} · {sessionSetCount(s)} sets · {imperial ? Math.round(lbFromKg(vol)) : Math.round(vol)}{" "}
                      {imperial ? "lb" : "kg"} moved
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function emptySession(): LiftSession {
  return {
    id: nid(),
    date: isoDate(),
    name: "Lift",
    lines: [],
    startedAt: Date.now(),
  };
}

function sessionFromSeed(
  seed: LiftSeed,
  sessions: LiftSession[],
  bodyKg: number,
  imperial: boolean,
  goalKind: GoalKind,
  hold: boolean,
): LiftSession {
  const lines: LiftLine[] = [];
  for (const moveId of seed.moveIds) {
    const move = moveById(moveId);
    if (!move) continue;
    const planned = seed.plan?.find((p) => p.moveId === moveId);
    lines.push({
      id: nid(),
      moveId,
      note: previousLine(sessions, moveId)?.note,
      sets: prescribeSets({
        moveId,
        sessions,
        bodyKg,
        imperial,
        goalKind,
        hold,
        planned,
      }).map((set) => ({
        id: nid(),
        reps: set.reps,
        weightKg: set.weightKg,
        done: false,
        warmup: set.warmup,
      })),
    });
  }
  return {
    id: nid(),
    date: seed.date || isoDate(),
    name: seed.name || "Lift",
    lines,
    startedAt: Date.now(),
  };
}
