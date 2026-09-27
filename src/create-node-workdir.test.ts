import { readFileSync } from 'node:fs';
import { defaultWorkdir, describeWorkdirError, workdirError, workdirForRequest, workdirRootOf } from './create-node-workdir';
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

// ── 客户端轻校验(daemon 才是最终裁决) ──
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
check('wizard sends workdir through workdirForRequest (omitted for old daemons)', wiz.includes('...workdirForRequest(workdirRoot, workdir),'));
check('submit is disabled while the workdir is invalid', wiz.includes('disabled={!canSubmit}') && wiz.includes('const canSubmit = !workdirErr;'));
check('unedited workdir follows the name', wiz.includes('workdirEdited ?? (workdirRoot ? defaultWorkdir(workdirRoot, name.trim())'));
check('row reuses the shared summaryRow layout', /testID="create-workdir-row"/.test(wiz) && wiz.includes('<View style={styles.summaryRow} testID="create-workdir-row">'));
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
check('api types carry default_workdir_root and node_spec.workdir', api.includes('default_workdir_root?: string;') && api.includes('workdir?: string;'));

console.log(`create node workdir: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
