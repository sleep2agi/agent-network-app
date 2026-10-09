import { readFileSync } from 'node:fs';
import { defaultWorkdir, describeWorkdirError, hasNonAsciiBelowRoot, randomHex6, workdirError, workdirForRequest, workdirRootOf, workdirSlug } from './create-node-workdir';
import { createRequestVerdict } from './create-request-status';

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name); } };

// ── 支持检测:只有 default_workdir_root 是非空字符串才算支持 ──
check('new daemon (root present) → supported', workdirRootOf({ default_workdir_root: '/home/alice' }) === '/home/alice');
check('old daemon (field absent) → unsupported', workdirRootOf({}) === null);
check('empty / whitespace / non-string root → unsupported', workdirRootOf({ default_workdir_root: '  ' }) === null
  && workdirRootOf({ default_workdir_root: 42 as unknown as string }) === null);

// ── 默认规则 <root>/<name> ──
check('default = <root>/<name>', defaultWorkdir('/home/alice', 'my-agent-1') === '/home/alice/my-agent-1');
check('root with trailing slash is not doubled', defaultWorkdir('/home/alice/', 'x') === '/home/alice/x');
check('Windows-shaped root joins with backslash', defaultWorkdir('C:\\Users\\alice', 'x') === 'C:\\Users\\alice\\x');
check('Windows root with trailing backslash is not doubled', defaultWorkdir('C:\\Users\\alice\\', 'x') === 'C:\\Users\\alice\\x');

// ── ASCII slug(owner 规则:工作目录一律英文/ASCII) ──
const fakePy = (t: string) => ({ '吉他大师': 'jitadashi', 'N站牛': 'nzhanniu', '🎸': '🎸' } as Record<string, string>)[t] ?? null;
check('ASCII name: lowercase, other chars → -', workdirSlug('My_Agent 1', 'node-000000', fakePy) === 'my-agent-1');
check('already-safe name is unchanged', workdirSlug('my-agent-1', 'node-000000', fakePy) === 'my-agent-1');
check('🔴 吉他大师 → jitadashi (pinyin)', workdirSlug('吉他大师', 'node-000000', fakePy) === 'jitadashi');
check('mixed CJK/ASCII → pinyin keeps the ASCII part', workdirSlug('N站牛', 'node-000000', fakePy) === 'nzhanniu');
check('nothing usable (emoji) → fallback', workdirSlug('🎸', 'node-1a2b3c', fakePy) === 'node-1a2b3c');
check('dictionary unavailable → fallback, never the raw CJK', workdirSlug('吉他大师', 'node-1a2b3c', () => null) === 'node-1a2b3c');
check('empty / only separators → fallback', workdirSlug('  ', 'node-1a2b3c', fakePy) === 'node-1a2b3c' && workdirSlug('__--', 'node-1a2b3c', fakePy) === 'node-1a2b3c');
check('leading/trailing separators trimmed', workdirSlug('-x-', 'f', fakePy) === 'x');
check('#652 digit-leading slug gets node- prefix (folder rule ^[a-z])', workdirSlug('123', 'f', fakePy) === 'node-123' && workdirSlug('_x', 'f', fakePy) === 'x' && workdirSlug('2号机', 'f', () => '2haoji') === 'node-2haoji');
check('#652 every slug satisfies the folder rule', ['My_Agent 1', '123', '-x-', 'a'.repeat(80), '9'.repeat(70), '吉他大师', '🎸'].every(n => /^[a-z][a-z0-9-]{0,63}$/.test(workdirSlug(n, 'node-1a2b3c', fakePy))));
check('slug capped at 64 chars without a trailing dash', (() => { const s = workdirSlug('a'.repeat(63) + '-bbbb', 'f', fakePy); return s.length <= 64 && !s.endsWith('-'); })());
check('every slug is [a-z0-9-]', ['My_Agent 1', '吉他大师', 'N站牛', '🎸', 'A.B.C'].every(n => /^[a-z0-9-]+$/.test(workdirSlug(n, 'node-abcdef', fakePy))));
check('randomHex6 is 6 lowercase hex', /^[0-9a-f]{6}$/.test(randomHex6()) && randomHex6(() => 0.999) === 'ffffff');
check('real pinyin-pro dictionary: 吉他大师 → jitadashi', workdirSlug('吉他大师', 'node-000000') === 'jitadashi');
check('real pinyin-pro dictionary: N站牛 → nzhanniu', workdirSlug('N站牛', 'node-000000') === 'nzhanniu');
check('default path for 吉他大师 is ASCII', defaultWorkdir('/home/alice', workdirSlug('吉他大师', 'f', fakePy)) === '/home/alice/jitadashi');

// ── 客户端轻校验(daemon 才是最终裁决) ──
check('🔴 edited CJK dir under the root is rejected client-side', workdirError('/home/alice/吉他大师', '/home/alice') !== null
  && workdirError('~/吉他大师', '/home/alice') !== null && workdirError('/srv/节点', '/home/alice') !== null);
check('non-ASCII root itself is not held against the user', !hasNonAsciiBelowRoot('/home/张三/proj', '/home/张三')
  && workdirError('/home/张三/proj', '/home/张三') === null);
check('workdir_not_ascii from the daemon is mapped', (describeWorkdirError('validate: workdir_not_ascii') ?? '').includes('ASCII'));
const R = '/home/alice';
check('default path passes', workdirError('/home/alice/my-agent-1', R) === null);
check('~/sub passes (expanded daemon-side)', workdirError('~/proj', R) === null);
check('Windows drive path passes', workdirError('D:\\work\\x', 'C:\\Users\\alice') === null);
check('empty is rejected', workdirError('  ', R) !== null);
check('relative path is rejected', workdirError('work/x', R) !== null && workdirError('./x', R) !== null);
check('~user form is rejected', workdirError('~bob/x', R) !== null);
check('the root itself (home) is rejected', workdirError('/home/alice', R) !== null && workdirError('/home/alice/', R) !== null);
check('bare ~ is rejected (it is home)', workdirError('~', R) !== null);
check('a sibling that only shares the prefix passes', workdirError('/home/alice2', R) === null);

// ── 请求载荷:支持才带,不支持一定不带 ──
check('supported → payload carries trimmed workdir', JSON.stringify(workdirForRequest(R, ' /home/alice/x ')) === '{"workdir":"/home/alice/x"}');
check('unsupported → payload has no workdir key', Object.keys(workdirForRequest(null, '/home/alice/x')).length === 0);

// ── 错误码 → 人话 ──
check('non-workdir errors are left alone', describeWorkdirError('runtime_invalid') === null && describeWorkdirError(undefined) === null);
check('daemon validate: workdir_is_home mapped', describeWorkdirError('validate: workdir_is_home') === '工作目录不能是家目录本身');
check('workdir_has_other_node keeps the other node name', (describeWorkdirError('validate: workdir_has_other_node:other-node') ?? '').includes('other-node'));
check('hub workdir_not_supported_by_daemon mapped', (describeWorkdirError('workdir_not_supported_by_daemon') ?? '').includes('升级'));
check('unknown workdir_* code still reads as a workdir problem', (describeWorkdirError('workdir_not_directory') ?? '').includes('workdir_not_directory'));
const v = createRequestVerdict({ status: 'rejected', error: 'validate: workdir_is_system_dir' });
check('create-request verdict turns a daemon workdir rejection into words + keeps the raw code',
  v.kind === 'failed' && v.text.includes('系统目录') && v.text.includes('workdir_is_system_dir'));

// ── 接线契约 ──
const wiz = readFileSync(new URL('./CreateNodeWizardScreen.tsx', import.meta.url), 'utf8');
check('wizard only renders the row when the daemon advertises a root', wiz.includes('{workdirRoot ? (') && wiz.includes('testID="create-workdir-row"'));
check('wizard sends workdir through workdirForRequest (omitted for old daemons)', wiz.includes('workdirField: workdirForRequest(workdirRoot, workdir),')
  && readFileSync(new URL('./create-node-request.ts', import.meta.url), 'utf8').includes('...i.workdirField,'));
const submitExpression = wiz.match(/const canSubmit = ([^;]+);/)?.[1];
check('submit disabled state is wired to the validation expression', wiz.includes('disabled={!canSubmit}') && !!submitExpression);
if (submitExpression) {
  const submitAllowed = new Function('workdirErr', 'openCodeError', 'nameValid', 'isRuntimeAllowed', 'runtimeId', `return (${submitExpression});`);
  check('valid submission remains enabled', submitAllowed(null, null, true, () => true, 'opencode-cli') === true);
  check('submit is disabled while the workdir is invalid', submitAllowed('invalid directory', null, true, () => true, 'opencode-cli') === false);
  check('V2 validation failure also disables submit', submitAllowed(null, 'consent required', true, () => true, 'opencode-cli') === false);
  check('invalid name disables submit', submitAllowed(null, null, false, () => true, 'opencode-cli') === false);
  check('unavailable runtime disables submit', submitAllowed(null, null, true, () => false, 'opencode-cli') === false);
}
check('unedited workdir follows the name through the ASCII slug (via the step-1 folder, #652)',
  wiz.includes('const folder = folderEdited ?? workdirSlug(name, workdirFallback);')
  && wiz.includes('workdirEdited ?? (workdirRoot ? defaultWorkdir(workdirRoot, folder)'));
check('fallback is fixed once per wizard (useState initialiser, not per render)', wiz.includes('const [workdirFallback] = useState(() => `node-${randomHex6()}`);'));
check('row reuses the shared summaryRow layout', /testID="create-workdir-row"/.test(wiz) && wiz.includes('<View style={styles.summaryRow} testID="create-workdir-row">'));
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
check('api types carry default_workdir_root and node_spec.workdir', api.includes('default_workdir_root?: string;') && api.includes('workdir?: string;'));

console.log(`create node workdir: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
