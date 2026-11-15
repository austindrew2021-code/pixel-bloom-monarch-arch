/**
 * f3: what the shell paints for the tester check. `null` = the check hasn't finished yet
 * (first paint / cold start): a neutral splash, never the private-testing gate.
 * The unlock decision itself stays in tester.ts (isTesterUnlocked), unchanged.
 */
export type GateView = "splash" | "gate" | "app";

export function gateView(allowed: boolean | null): GateView {
  if (allowed === null) return "splash";
  return allowed ? "app" : "gate";
}

/** r2: the splash may wait this long for the unlock + startup check, then shows the gate. */
export const GATE_TIMEOUT_MS = 3000;

/** The unlock check, fail closed: anything but a clean `true` (a throw, blocked storage) is locked. */
export function checkUnlock(check: () => boolean): boolean {
  try {
    return check() === true;
  } catch {
    return false;
  }
}

type Setter = (next: (prev: boolean | null) => boolean | null) => void;

/**
 * r2: run the cold-start check. Locked or throwing → gate now. Unlocked → app once the saved
 * kitchen has loaded (`startup` resolves true); a failed or throwing startup → gate. If neither
 * has answered within `ms`, the splash becomes the gate. It never falls back to the app: only a
 * clean unlock plus a good startup sets `true`. Returns a cancel function for the effect cleanup.
 */
export function runStartupGate(opts: {
  check: () => boolean;
  startup: () => Promise<boolean>;
  set: Setter;
  ms?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
  clear?: (handle: unknown) => void;
}): () => void {
  const schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const clear = opts.clear ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let live = true;
  const handle = schedule(() => {
    if (live) opts.set((prev) => (prev === null ? false : prev));
  }, opts.ms ?? GATE_TIMEOUT_MS);
  if (!checkUnlock(opts.check)) {
    opts.set(() => false);
    return () => {
      live = false;
      clear(handle);
    };
  }
  let started: Promise<boolean>;
  try {
    started = Promise.resolve(opts.startup());
  } catch {
    started = Promise.resolve(false);
  }
  started.then(
    (ok) => {
      if (live) opts.set((prev) => (ok === true ? true : prev === null ? false : prev));
    },
    () => {
      if (live) opts.set((prev) => (prev === null ? false : prev));
    },
  );
  return () => {
    live = false;
    clear(handle);
  };
}
