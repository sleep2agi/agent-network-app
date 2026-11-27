// #5675 PR-2 / PR-3 —— 节点密钥页列表读取不锁表单 + 8 秒超时降级 + 热生效四态映射单测与接线守卫。
import { readFileSync } from 'node:fs';
import {
  SECRET_LIST_SOFT_TIMEOUT_MS,
  secretFormEditable,
  secretListStatusText,
  secretSaveDisabled,
  secretWriteOutcome,
} from './scoped-secrets-ui-model';
import { SECRET_SHADOWED_COPY } from './chat-secret-auto-apply';

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

// #5675 PR-3: activation 四态映射
const hotPut = secretWriteOutcome('hot_applied', 'put', true);
ck('hot_applied 不弹重启且用 running 色', hotPut.kind === 'hot_applied' && !hotPut.shouldOfferRestart && hotPut.tone === 'running' && hotPut.i18nKey === 'scopedSecrets.hotApplied');
const hotDel = secretWriteOutcome('hot_applied', 'delete', false);
ck('hot_applied 删除用 hotDeleted 文案且不弹重启', !hotDel.shouldOfferRestart && hotDel.i18nKey === 'scopedSecrets.hotDeleted');
const pendingPut = secretWriteOutcome('hot_pending_idle', 'put', true);
ck('hot_pending_idle 不弹重启且提示空闲后热生效', pendingPut.kind === 'hot_pending_idle' && !pendingPut.shouldOfferRestart && pendingPut.tone === 'blocked' && pendingPut.i18nKey === 'scopedSecrets.hotPendingIdle');
const shadowed = secretWriteOutcome('shadowed', 'put', true);
ck('shadowed 不弹重启、用 blocked 色且直出精确规范文案',
  shadowed.kind === 'shadowed' && !shadowed.shouldOfferRestart && shadowed.tone === 'blocked'
  && shadowed.text === SECRET_SHADOWED_COPY
  && shadowed.text === '这个 Key 被节点启动环境里的同名设置覆盖了，在这里改不会生效；请到节点配置里删掉那一项');
const nextStart = secretWriteOutcome('next_start', 'put', false);
ck('next_start 保持原重启闭环与文案', nextStart.kind === 'next_start' && nextStart.shouldOfferRestart && nextStart.i18nKey === 'scopedSecrets.saved');
const legacy = secretWriteOutcome(undefined, 'delete', true);
ck('旧节点缺省 activation 退回 next_start 重启闭环', legacy.kind === 'next_start' && legacy.shouldOfferRestart && legacy.i18nKey === 'scopedSecrets.nodeDeleted');

// #5675 PR-3 源码接线守卫
ck('ScopedSecretsSection 接入 secretsHotCapable、secretWriteOutcome 与 node_secret reload',
  section.includes('secretsHotCapable') && section.includes('secretWriteOutcome') && section.includes("action: 'reload'"));
const detail = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
ck('NodeDetailScreen 把 secrets_hot_capable 透传给 ScopedSecretsSection',
  detail.includes('secretsHotCapable={s.secrets_hot_capable === true}'));
const chatCard = readFileSync(new URL('./ChatSecretCard.tsx', import.meta.url), 'utf8');
ck('ChatSecretCard 透传 activation 到 runChatSecretAutoApply 且处理 shadowed 配色',
  chatCard.includes('activation,') && chatCard.includes("applyState === 'shadowed'") && chatCard.includes("action: 'reload'"));

console.log(`scoped-secrets-ui-model: ${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
