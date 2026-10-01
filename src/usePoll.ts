import { useEffect } from 'react';
import { AppState } from 'react-native';
import { pollBackoffMs, subscribeReconnect } from './connectivity';
import { nextPollDelay } from './poll-delay';
import { installConnectivityLifecycle } from './connectivity-lifecycle';

installConnectivityLifecycle();

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
 * While reads are failing the interval backs off exponentially (connectivity.ts
 * pollBackoffMs, capped at a minute); a tap on the connectivity banner or the
 * first successful read anywhere (requestReconnect) runs a tick right away.
 *
 * `deps` are the effect deps (usually [load], where load is a useCallback).
 * `fn` may close over refs (e.g. () => load(limitRef.current)) since refs read
 * live at call time.
 */
export function usePoll(fn: () => void | Promise<unknown>, intervalMs: number, deps: React.DependencyList): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active = true;
    let running = false;
    const schedule = (delay: number) => {
      if (!active) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, delay);
    };
    const tick = async () => {
      if (!active) return;
      if (running) { schedule(intervalMs); return; }
      running = true;
      const started = Date.now();
      try { await fn(); } catch { /* the poller itself never throws; keep polling */ }
      running = false;
      schedule(Math.max(nextPollDelay(intervalMs, Date.now() - started), pollBackoffMs(intervalMs)));
    };
    void tick();
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        active = true;
        void tick();
      } else {
        active = false;
        if (timer) { clearTimeout(timer); timer = null; }
      }
    });
    const unsubReconnect = subscribeReconnect(() => { if (active && !running) void tick(); });
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      sub.remove();
      unsubReconnect();
    };
  }, deps);
}
