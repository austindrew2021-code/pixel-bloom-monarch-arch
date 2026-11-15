/**
 * r2: load the saved kitchen without crashing when storage is blocked. With storage blocked,
 * zustand's persist API can be missing (`useSpoonful.persist` undefined → TypeError on
 * 'rehydrate'), or rehydrate can throw. Both resolve `false` instead. One load per page.
 */
type Persisted = { persist?: { rehydrate?: () => unknown } };

const loads = new WeakMap<object, Promise<boolean>>();

export function safeRehydrate(store: Persisted): Promise<boolean> {
  try {
    const persist = store.persist;
    if (!persist || typeof persist.rehydrate !== "function") return Promise.resolve(false);
    return Promise.resolve(persist.rehydrate()).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

export function rehydrateOnce(store: Persisted): Promise<boolean> {
  let p = loads.get(store);
  if (!p) {
    p = safeRehydrate(store);
    loads.set(store, p);
  }
  return p;
}
