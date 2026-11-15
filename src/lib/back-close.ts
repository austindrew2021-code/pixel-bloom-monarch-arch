import { useEffect, useRef } from "react";

/**
 * f3: Android / browser Back closes an open card instead of leaving the app.
 * Opening pushes one history entry (same URL); Back pops it and closes the card.
 * Closing from the UI removes that entry again, so the next Back behaves as before.
 * In the APK, MainActivity already sends Back to the WebView while it canGoBack().
 */
export type BackWindow = {
  history: { state: unknown; pushState(data: unknown, unused: string): void; replaceState(data: unknown, unused: string): void; back(): void };
  addEventListener(type: "popstate", fn: () => void): void;
  removeEventListener(type: "popstate", fn: () => void): void;
};

const KEY = "spoonfulCard";
let seq = 0;
/**
 * r2: a UI close pops its entry on the next tick. If another layer opens in the same commit
 * (recipe card → "Cook this" → Cook mode), it takes over that entry instead, so the late pop
 * can't close the new layer.
 */
let pendingPop: { timer: ReturnType<typeof setTimeout>; win: BackWindow } | null = null;

function markOf(state: unknown): unknown {
  return state && typeof state === "object" ? (state as Record<string, unknown>)[KEY] : undefined;
}

export function createBackCloser(win: BackWindow, onBack: () => void) {
  let token = 0;
  const onPop = () => {
    if (!token) return;
    // Still on our entry (a pop elsewhere landed here): not a Back from the card.
    if (markOf(win.history.state) === token) return;
    token = 0;
    win.removeEventListener("popstate", onPop);
    onBack();
  };
  return {
    open() {
      if (token) return;
      token = ++seq;
      const prev = win.history.state && typeof win.history.state === "object" ? win.history.state : {};
      if (pendingPop && pendingPop.win === win && markOf(win.history.state) !== undefined) {
        clearTimeout(pendingPop.timer);
        pendingPop = null;
        win.history.replaceState({ ...(prev as object), [KEY]: token }, "");
      } else {
        win.history.pushState({ ...(prev as object), [KEY]: token }, "");
      }
      win.addEventListener("popstate", onPop);
    },
    close() {
      if (!token) return;
      const mine = markOf(win.history.state) === token;
      token = 0;
      win.removeEventListener("popstate", onPop);
      if (!mine) return;
      if (pendingPop) clearTimeout(pendingPop.timer);
      const timer = setTimeout(() => {
        if (pendingPop?.timer === timer) pendingPop = null;
        win.history.back();
      }, 0);
      pendingPop = { timer, win };
    },
    get isOpen() {
      return token !== 0;
    },
  };
}

/** While `open`, Back calls `close` (the card's own close). */
export function useBackToClose(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const closer = createBackCloser(window, () => closeRef.current());
    closer.open();
    return () => closer.close();
  }, [open]);
}
