import { useEffect, useRef, useState } from "react";
import { heartCall, zoneLabel } from "@/lib/workout-safety";

type BleChar = {
  startNotifications: () => Promise<unknown>;
  stopNotifications: () => Promise<unknown>;
  addEventListener: (name: string, fn: (event: Event) => void) => void;
  removeEventListener: (name: string, fn: (event: Event) => void) => void;
  value?: DataView;
};

/** Standard Bluetooth heart-rate service. Watches and chest straps that share it show up here. */
export function useHeartRate() {
  const [bpm, setBpm] = useState(0);
  const [state, setState] = useState<"off" | "on" | "missing">("off");

  async function connect() {
    const bluetooth = (navigator as Navigator & { bluetooth?: { requestDevice: (opts: unknown) => Promise<{ gatt?: { connect: () => Promise<{ getPrimaryService: (id: string) => Promise<{ getCharacteristic: (id: string) => Promise<BleChar> }> }> } }> } }).bluetooth;
    if (!bluetooth) {
      setState("missing");
      return;
    }
    try {
      const device = await bluetooth.requestDevice({
        filters: [{ services: ["heart_rate"] }],
        optionalServices: ["heart_rate"],
      });
      const server = await device.gatt?.connect();
      if (!server) return;
      const service = await server.getPrimaryService("heart_rate");
      const char = await service.getCharacteristic("heart_rate_measurement");
      const onChange = (event: Event) => {
        const value = (event.target as { value?: DataView } | null)?.value;
        if (!value) return;
        const flags = value.getUint8(0);
        const next = flags & 0x01 ? value.getUint16(1, true) : value.getUint8(1);
        if (next > 0 && next < 250) setBpm(next);
      };
      await char.startNotifications();
      char.addEventListener("characteristicvaluechanged", onChange);
      setState("on");
    } catch {
      setState("off");
    }
  }

  return { bpm, setBpm, state, connect };
}

/** Live strap or a typed bpm, plus the samples used for the saved average. */
export function useHeartSession(age: number, spo2 = 0) {
  const heart = useHeartRate();
  const samples = useRef<number[]>([]);
  const [override, setOverride] = useState(false);
  const call = heartCall({ bpm: heart.bpm, age, spo2 });
  useEffect(() => {
    if (heart.bpm > 30 && heart.bpm < 250) samples.current.push(heart.bpm);
  }, [heart.bpm]);
  useEffect(() => {
    if (call.level === "ok") setOverride(false);
  }, [call.level]);
  function avgHr(): number | undefined {
    const list = samples.current;
    if (list.length) return Math.round(list.reduce((sum, n) => sum + n, 0) / list.length);
    return heart.bpm > 0 ? heart.bpm : undefined;
  }
  return { ...heart, call, override, acknowledge: () => setOverride(true), avgHr, spo2 };
}

export function HeartWarn({
  call,
  onOverride,
}: {
  call: { level: "ok" | "rest" | "stop"; reason: string };
  onOverride: () => void;
}) {
  if (call.level === "ok") return null;
  return (
    <div className="mt-3 rounded-2xl bg-card p-3">
      <p className="text-sm leading-relaxed">{call.reason}</p>
      <BreathCue slow={call.level === "stop"} />
      <button type="button" className="mt-3 h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground" onClick={onOverride}>
        {call.level === "stop" ? "Keep going anyway" : "Skip this break"}
      </button>
    </div>
  );
}

export function HeartRow({
  age,
  bpm,
  spo2,
  state,
  onConnect,
  onType,
  override,
  onOverride,
  showWarn = true,
  compact = false,
}: {
  age: number;
  bpm: number;
  spo2?: number;
  state: "off" | "on" | "missing";
  onConnect: () => void;
  onType: (bpm: number) => void;
  override: boolean;
  onOverride: () => void;
  showWarn?: boolean;
  compact?: boolean;
}) {
  const call = heartCall({ bpm, age, spo2 });
  const [typing, setTyping] = useState(false);
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <p className="font-display text-3xl tabular-nums leading-none">{bpm > 0 ? bpm : "—"}</p>
        <p className="text-sm text-muted-foreground">{bpm > 0 ? `${zoneLabel(call.zone)} · bpm` : "Heart rate"}</p>
        <button type="button" className="ml-auto h-10 rounded-full bg-card px-3 text-xs font-semibold" onClick={onConnect}>
          {state === "on" ? "Strap on" : state === "missing" ? "No Bluetooth" : "Connect strap"}
        </button>
      </div>
      {compact && !typing ? (
        <button type="button" className="mt-1 h-9 text-xs font-semibold text-muted-foreground" onClick={() => setTyping(true)}>
          Type the number from the watch
        </button>
      ) : (
        <label className="mt-2 block text-xs text-muted-foreground">
          Or type the number from the watch
          <input
            inputMode="numeric"
            className="mt-1 h-11 w-full rounded-xl bg-card px-3 text-base tabular-nums"
            placeholder="bpm"
            onChange={(e) => onType(Number(e.target.value.replace(/[^\d]/g, "").slice(0, 3)) || 0)}
          />
        </label>
      )}
      {call.level !== "ok" && !override && showWarn ? (
        <HeartWarn call={call} onOverride={onOverride} />
      ) : null}
    </div>
  );
}

export function BreathCue({ slow }: { slow: boolean }) {
  const [phase, setPhase] = useState<"In" | "Hold" | "Out">("In");
  useEffect(() => {
    const steps: { name: "In" | "Hold" | "Out"; ms: number }[] = slow
      ? [
          { name: "In", ms: 4000 },
          { name: "Hold", ms: 2000 },
          { name: "Out", ms: 6000 },
        ]
      : [
          { name: "In", ms: 4000 },
          { name: "Hold", ms: 4000 },
          { name: "Out", ms: 4000 },
        ];
    let index = 0;
    let timer = window.setTimeout(function tick() {
      index = (index + 1) % steps.length;
      setPhase(steps[index]!.name);
      timer = window.setTimeout(tick, steps[index]!.ms);
    }, steps[0]!.ms);
    return () => window.clearTimeout(timer);
  }, [slow]);
  return <p className="mt-2 text-sm font-semibold">{phase}</p>;
}
