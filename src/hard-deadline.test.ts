import { describe, expect, test } from 'bun:test';
import { withHardDeadline, LOAD_HARD_DEADLINE_MS } from './hard-deadline';

describe('withHardDeadline', () => {
  test('正常 promise 原样返回（不改变结果）', async () => {
    await expect(withHardDeadline(Promise.resolve('ok'), 'tasks')).resolves.toBe('ok');
    await expect(withHardDeadline(Promise.reject(new Error('boom')), 'tasks')).rejects.toThrow('boom');
  });

  test('永不 settle ⇒ 按上限拒绝，错误里带 label（方便日志定位）', async () => {
    const never = new Promise<string>(() => {});
    await expect(withHardDeadline(never, 'chat-user', 20)).rejects.toThrow('chat-user exceeded 0s');
  });

  test('默认上限略高于读路径 12s', () => {
    expect(LOAD_HARD_DEADLINE_MS).toBeGreaterThan(12_000);
    expect(LOAD_HARD_DEADLINE_MS).toBeLessThanOrEqual(20_000);
  });
});
