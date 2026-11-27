// #5675 PR-2 —— 节点密钥页列表读取不锁表单 + 8 秒超时降级单测与接线守卫。
import { readFileSync } from 'node:fs';
import {
  SECRET_LIST_SOFT_TIMEOUT_MS,
  secretFormEditable,
  secretListStatusText,
  secretSaveDisabled,
} from './scoped-secrets-ui-model';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra?: unknown) => {
  t++;
  if (ok) { p++; console.log('✅', name); } else console.log('❌', name, extra === undefined ? '' : JSON.stringify(extra));
};

ck('名称列表软超时为 8000ms', SECRET_LIST_SOFT_TIMEOUT_MS === 8000);
ck('名称列表读取中 / 超时：表单仍可编辑、保存按钮不禁用',
  secretFormEditable({ writing: false, hardBlock: null }) && !secretSaveDisabled({ writing: false, hardBlock: null }));
ck('正在保存写入时：禁止重复编辑与点击保存',
  !secretFormEditable({ writing: true, hardBlock: null }) && secretSaveDisabled({ writing: true, hardBlock: null }));
ck('明确 unsupported / forbidden 时：禁用保存',
  secretSaveDisabled({ writing: false, hardBlock: 'unsupported' })
  && secretSaveDisabled({ writing: false, hardBlock: 'forbidden' })
  && !secretFormEditable({ writing: false, hardBlock: 'unsupported' }));
ck('读取中文案简洁为「读取中…」', secretListStatusText('loading') === '读取中…');
ck('8 秒超时文案符合规范', secretListStatusText('timed_out') === '节点正在忙，名称列表暂时读不到；仍可直接保存新密钥');
ck('ready / idle 无多余提示', secretListStatusText('ready') === '' && secretListStatusText('idle') === '');

const section = readFileSync(new URL('./ScopedSecretsSection.tsx', import.meta.url), 'utf8');
ck('ScopedSecretsSection 接入 SECRET_LIST_SOFT_TIMEOUT_MS 与独立 listState',
  section.includes('SECRET_LIST_SOFT_TIMEOUT_MS') && section.includes('secretListStatusText') && section.includes('secretSaveDisabled'));
ck('输入框和保存按钮不再绑定 listLoading / !snapshot 锁死',
  !section.includes('disabled={busy||!snapshot}') && section.includes('editable={formEditable}') && section.includes('disabled={saveDisabled}'));
ck('无 snapshot 时点保存会即时拉取 revision 再 put（不猜 0）',
  section.includes('resolveRevisionForWrite'));

console.log(`scoped-secrets-ui-model: ${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
