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
/** 看门狗倍数：4。
 *  选 4 而不是 2：读路径的硬超时是 12s（api.ts 的 readDeadlineMs），5s 的轮询间隔下
 *  2× 只有 10s —— 一次「刚好慢一点但正常」的读就会被误判成卡死并打 warn。
 *  选 4 而不是 10：4×=20s 已经明显超过 12s 读超时 + 一次排期抖动；再放大就等于
 *  让真正停摆的页面多卡 30s 以上才被发现，得不偿失。 */
export const WATCHDOG_FACTORS = 4;

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
    // 看门狗：single-flight 的闩若超过 WATCHDOG_FACTORS × interval 还没复位，
    // 说明这次 fn() 的 promise 没有按时 settle（读路径理论上都有 12s 硬超时，但
    // 「理论上」不是证据 —— 一旦某条路径绕过它，整个页面的轮询会永久停摆，而且
    // 从界面上只能看到「不刷新」，看不出「轮询死了」）。这里强制复位并记 warn。
    let runningSince = 0;
    let gen = 0;
    const tick = async () => {
      if (!active) return;
      if (running) {
        const stuckMs = Date.now() - runningSince;
        if (stuckMs <= intervalMs * WATCHDOG_FACTORS) { schedule(intervalMs); return; }
        console.warn(`[usePoll] single-flight stuck for ${stuckMs}ms (> ${WATCHDOG_FACTORS}x${intervalMs}ms); resetting`);
        running = false;
      }
      const myGen = ++gen;
      running = true;
      runningSince = Date.now();
      const started = runningSince;
      try { await fn(); } catch { /* the poller itself never throws; keep polling */ }
      // 被看门狗复位过的那一代，settle 时不要再改状态/排期（否则会和新的 tick 打架）
      if (myGen !== gen) return;
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
