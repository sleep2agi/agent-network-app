// 诊断日志只计数、不改行为
import { describe, expect, test } from 'bun:test';
import { createChatLoadDiag } from './chat-load-diag';

describe('createChatLoadDiag', () => {
  test('三类丢弃分别计数，且不抛错（日志失败不影响主流程）', () => {
    const logs: string[] = [];
    const warns: string[] = [];
    const origLog = console.log, origWarn = console.warn;
    console.log = (...a: any[]) => { logs.push(a.join(' ')); };
    console.warn = (...a: any[]) => { warns.push(a.join(' ')); };
    try {
      const d = createChatLoadDiag('t');
      d.loadStarted(1, false, 20);
      d.paintDropped(1, 'token');
      d.paintDropped(1, 'sequence');
      d.paintDropped(1, 'unmounted');
      d.paintApplied(2, 3, -1);
      d.loadSettled(2, 42);
    } finally { console.log = origLog; console.warn = origWarn; }
    expect(logs.join('\n')).toContain('start seq=1 token=stale');
    expect(logs.join('\n')).toContain('paint applied seq=2 rows=3');
    expect(logs.join('\n')).toContain('settle seq=2 ms=42');
    expect(warns.join('\n')).toContain('reason=token');
    expect(warns.join('\n')).toContain('dropped(token=1,seq=1,unmounted=1)');
  });
});
