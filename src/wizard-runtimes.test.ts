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
check('opencode-cli default model is an OpenCode free model (no key needed)', entry('opencode-cli').includes("'opencode/mimo-v2.5-free'"));
for (const id of ['claude-code-cli', 'codex-app-server', 'grok-build-cli']) {
  check(`${id} still follows the host login (empty models)`, entry(id).includes('models: []'));
}
check('summary falls back to the first model of the runtime', src.includes("v={model || runtime.models[0] || '跟随宿主登录'}"));
console.log(`wizard runtimes: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
