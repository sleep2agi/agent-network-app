// 新建节点向导的 runtime 表:哪些 runtime 必须带模型。
// OpenCode 共存 runtime 要求显式 provider/model(agent-node requireOpenCodeCopresenceModel),
// 向导若给空 models 就会在 daemon 那边以「requires an explicit provider/model」失败(2026-09-07 Mac mini 真跑)。
import { readFileSync } from 'node:fs';

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name); } };
const src = readFileSync(new URL('./CreateNodeWizardScreen.tsx', import.meta.url), 'utf8');
const table = src.slice(src.indexOf('const RUNTIMES'), src.indexOf('const PERMISSION_MODES'));
const entry = (id: string) => table.split('\n').find(l => l.includes(`id: '${id}'`)) ?? '';
check('opencode-cli offers at least one provider/model (never an empty list)', /models: \['opencode\/[^']+'/.test(entry('opencode-cli')));
check('opencode-cli default model is an OpenCode free model (no key needed)', entry('opencode-cli').includes("'opencode/mimo-v2.6-flash-free'"));
check('opencode-cli no longer offers the withdrawn mimo-v2.5-free (HTTP 500 on OpenCode Zen)', !entry('opencode-cli').includes('mimo-v2.5-free'));
for (const id of ['claude-code-cli', 'codex-app-server', 'grok-build-cli']) {
  check(`${id} still follows the host login (empty models)`, entry(id).includes('models: []'));
}
check('summary falls back to the first model of the runtime', src.includes("v={model || runtime.models[0] || '跟随宿主登录'}"));
// owner 2026-09-25:Grok 默认 = ACP;共存(grok-build-cli)降为实验性,收进 Grok 行的「高级」折叠。
// (原先这里钉的是 09-23 方案 A 的「预览」标签和「指向 build-acp」的 note —— 方向相同,措辞升级。)
check('Grok shows as ONE plain choice that creates ACP (label "Grok", id grok-build-acp, not advanced)',
  /id: 'grok-build-acp', label: 'Grok', /.test(entry('grok-build-acp')) && !entry('grok-build-acp').includes('advancedOf'));
check('grok-build-cli is labelled 共存模式（实验性）', entry('grok-build-cli').includes("label: '共存模式（实验性）'"));
check('grok-build-cli sits inside the Grok 「高级」 disclosure', entry('grok-build-cli').includes("advancedOf: 'grok-build-acp'"));
for (const k of ['实验性', '打字', '钉', 'macOS', 'skills', 'ACP']) {
  check(`grok-build-cli warning mentions ${k}`, /note: '[^']*'/.test(entry('grok-build-cli')) && (entry('grok-build-cli').match(/note: '([^']*)'/)?.[1] ?? '').includes(k));
}
check('ACP row comes before the co-presence row in the table', table.indexOf("id: 'grok-build-acp'") < table.indexOf("id: 'grok-build-cli'"));
check('only one entry uses advancedOf (the Grok co-presence one)', (table.match(/advancedOf:/g) ?? []).length === 1);
check('step 1 renders the primary list, not the raw table', src.includes('{primaryRuntimes(RUNTIMES).map(r => {') && !src.includes('{RUNTIMES.map(r => {'));
check('the disclosure is labelled 高级 and renders its rows when open',
  src.includes('<Text style={styles.advancedToggleText}>高级</Text>') && src.includes('{open ? kids.map(k => renderRuntimeRow(k, true)) : null}'));
check('the initial runtime prefers the primary list over advanced rows', (src.match(/primaryRuntimes\(RUNTIMES\)\.find\(r => supported\.includes\(r\.id\)\)/g) ?? []).length === 2);
// 选中才显示 note(主列表);折叠里的实验性行展开即显示(选之前就看到代价)。
check('runtime notes: shown when selected, or always inside an open disclosure', src.includes('const showNote = !!r.note && allowed && (selected || nested);'));
check('grok-build-cli keeps its runtime id (existing nodes unaffected)', entry('grok-build-cli').includes("id: 'grok-build-cli'"));
console.log(`wizard runtimes: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
