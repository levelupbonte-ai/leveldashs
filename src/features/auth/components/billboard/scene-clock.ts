'use client';

import { useSyncExternalStore } from 'react';

/**
 * One clock for the whole deck. Everything on screen is a pure function of `t`
 * (ms inside the current scene): React re-renders only when a selected primitive
 * changes (a typed character, a cue), and continuous motion (auto-scroll,
 * progress bar) is written straight to transform / custom properties each frame.
 */
export class SceneClock {
  t = 0;
  private subs = new Set<() => void>();
  private frames = new Set<(t: number) => void>();

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  };

  onFrame = (fn: (t: number) => void) => {
    this.frames.add(fn);
    return () => {
      this.frames.delete(fn);
    };
  };

  set(t: number) {
    this.t = t;
    this.frames.forEach((fn) => fn(t));
    this.subs.forEach((fn) => fn());
  }
}

/** Re-renders only when the selected primitive changes. */
export function useClockValue<T extends number | string | boolean>(
  clock: SceneClock,
  select: (t: number) => T
): T {
  return useSyncExternalStore(
    clock.subscribe,
    () => select(clock.t),
    () => select(0)
  );
}
