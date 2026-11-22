// usePoll 看门狗：single-flight 闩超时强制复位（防止整页轮询永久停摆）
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dir, 'usePoll.ts'), 'utf8');

describe('usePoll watchdog', () => {
  test('倍数是 4（2 会误伤 12s 读超时，10 会让停摆多藏 30s）', () => {
    expect(/WATCHDOG_FACTORS = 4;/.test(src)).toBe(true);
  });

  test('卡死判定 + warn + 复位都在 tick 里', () => {
    expect(src).toContain('intervalMs * WATCHDOG_FACTORS');
    expect(src).toContain('[usePoll] single-flight stuck');
    expect(src).toContain('running = false;');
  });

  test('被复位的那一代 settle 后不再改状态（gen 守卫）', () => {
    expect(src).toContain('myGen !== gen');
  });
});
