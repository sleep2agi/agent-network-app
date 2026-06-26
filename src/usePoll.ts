import { useEffect } from 'react';
import { AppState } from 'react-native';

/**
 * Foreground-only polling (perf: access speed / battery / data).
 *
 * Runs `fn` once immediately, then every `intervalMs` while the app is
 * foregrounded. On background it stops polling — no point spending
 * network/battery on a screen the user can't see, and background JS timers get
 * throttled anyway. On return to foreground it refreshes immediately AND
 * restarts the interval, so switching back shows current data without waiting
 * for the next tick.
 *
 * `deps` are the effect deps (usually [load], where load is a useCallback).
 * `fn` may close over refs (e.g. () => load(limitRef.current)) since refs read
 * live at call time.
 */
export function usePoll(fn: () => void, intervalMs: number, deps: React.DependencyList): void {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = setInterval(fn, intervalMs);
    fn();
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        fn();
        if (!timer) timer = setInterval(fn, intervalMs);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });
    return () => {
      if (timer) clearInterval(timer);
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
