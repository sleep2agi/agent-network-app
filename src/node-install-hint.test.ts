import { describe, expect, test } from 'bun:test';
import { installCommand, installHint, MISSING_VERSION_NOTE, PAIR_AUTHORITY_NOTE } from './node-install-hint';

describe('installHint', () => {
  test('两个版本都在 → 给出两包一起装的命令，并说明正确答案以 anet pair 为准', () => {
    const hint = installHint({ cliVersion: '2.3.0-preview.231', nodeVersion: '2.5.0-preview.199' });
    expect(hint.kind).toBe('ready');
    if (hint.kind !== 'ready') throw new Error('unreachable');
    expect(hint.command).toBe(
      'npm install -g @sleep2agi/agent-network@2.3.0-preview.231 @sleep2agi/agent-node@2.5.0-preview.199',
    );
    expect(hint.note).toBe(PAIR_AUTHORITY_NOTE);
    // 单边命令是当初的事故成因：命令里必须两个包都在。
    expect(hint.command).toContain('@sleep2agi/agent-network@');
    expect(hint.command).toContain('@sleep2agi/agent-node@');
  });

  test('只有 CLI 版本 → 不给命令（绝不生成单边安装命令）', () => {
    const hint = installHint({ cliVersion: '2.3.0-preview.231', nodeVersion: null });
    expect(hint.kind).toBe('unknown');
    if (hint.kind !== 'unknown') throw new Error('unreachable');
    expect(hint.missing).toEqual(['node']);
    expect(hint.note).toBe(MISSING_VERSION_NOTE);
    expect(JSON.stringify(hint)).not.toContain('npm install');
  });

  test('只有 node 版本 → 同样不给命令', () => {
    const hint = installHint({ cliVersion: undefined, nodeVersion: '2.5.0-preview.199' });
    expect(hint.kind).toBe('unknown');
    if (hint.kind !== 'unknown') throw new Error('unreachable');
    expect(hint.missing).toEqual(['cli']);
  });

  test('空串与纯空白当作缺失，而不是当作版本', () => {
    const hint = installHint({ cliVersion: '   ', nodeVersion: '' });
    expect(hint.kind).toBe('unknown');
    if (hint.kind !== 'unknown') throw new Error('unreachable');
    expect(hint.missing).toEqual(['cli', 'node']);
  });

  test('含空白 / @ / 斜杠的版本串被拒（防止拼出可被注入执行的命令）', () => {
    // 注意：首尾空白会被 trim 掉，所以 ' 2.3.0 ' 是合法的；这里必须是**内部**才非法。
    for (const bad of ['2.3.0 preview', '2.3.0; rm -rf /', '@evil/pkg', 'a/b', 'v2.3.0\tx']) {
      const hint = installHint({ cliVersion: bad, nodeVersion: '2.5.0-preview.199' });
      expect(hint.kind).toBe('unknown');
      if (hint.kind !== 'unknown') throw new Error('unreachable');
      expect(hint.invalid).toContain(bad.trim());
      expect(hint.missing).toEqual(['cli']);
    }
  });

  test('首尾空白会被裁掉，但不会改变合法版本的语义', () => {
    const hint = installHint({ cliVersion: ' 2.3.0-preview.231 ', nodeVersion: '\t2.5.0-preview.199 ' });
    expect(hint.kind).toBe('ready');
    if (hint.kind !== 'ready') throw new Error('unreachable');
    expect(hint.cliVersion).toBe('2.3.0-preview.231');
    expect(hint.nodeVersion).toBe('2.5.0-preview.199');
  });
});

describe('installCommand', () => {
  test('两个包在一个 npm install -g 里：分开装会各拿各自默认 tag', () => {
    expect(installCommand('1.2.3', '4.5.6')).toBe(
      'npm install -g @sleep2agi/agent-network@1.2.3 @sleep2agi/agent-node@4.5.6',
    );
  });
});
