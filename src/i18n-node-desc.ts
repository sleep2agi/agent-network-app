import { registerTranslations } from './i18n';

// 节点职责介绍(admin 2026-11-15)。
export const nodeDescTranslations = {
  'nodeDesc.title': ['职责介绍', 'Responsibilities'],
  'nodeDesc.hint': ['给其他节点和同事看的：它负责什么、能干什么、什么事找它。别的节点派活前会读到。规则文件（AGENTS.md）是它给自己看的，不一样。', 'For other nodes and people: what it owns, what it can do, when to ask it. Other nodes read this before handing it work. The rules file (AGENTS.md) is for the node itself.'],
  'nodeDesc.empty': ['还没写职责介绍。写清楚它负责什么、能干什么，别的节点才知道什么事该找它。', 'No responsibilities yet. Describe what it owns and can do so other nodes know when to ask it.'],
  'nodeDesc.edit': ['编辑', 'Edit'],
  'nodeDesc.write': ['写职责介绍', 'Write responsibilities'],
  'nodeDesc.template': ['用模板', 'Use template'],
  'nodeDesc.save': ['保存', 'Save'],
  'nodeDesc.saving': ['正在保存…', 'Saving…'],
  'nodeDesc.cancel': ['取消', 'Cancel'],
  'nodeDesc.placeholder': ['例如：负责 App 发版——派发构建、批签名、跑发版校验。什么事找我：发新版、TestFlight。不做：Hub 改动。', 'e.g. Owns App releases: dispatches builds, approves signing, runs release checks. Ask me for: new releases, TestFlight. Not me: Hub changes.'],
  'nodeDesc.count': ['{count} / {max}', '{count} / {max}'],
  'nodeDesc.saved': ['已保存，其他节点下次读状态就能看到', 'Saved. Other nodes see it on their next status read.'],
  'nodeDesc.tooLong': ['超过 {max} 字了，删短一点再保存', 'Over {max} characters. Shorten it before saving.'],
  'nodeDesc.conflict': ['别人刚改过这个节点的信息，已读回最新的，请再保存一次', 'Someone else just changed this node. The latest version is loaded; save again.'],
  'nodeDesc.invalid': ['Hub 拒收了这段文字（格式或长度不对）', 'The Hub rejected this text (format or length).'],
  'nodeDesc.unsupported': ['这个 Hub 版本还不支持职责介绍，升级 Hub 后再写', 'This Hub version does not support responsibilities yet. Upgrade the Hub first.'],
  'nodeDesc.forbidden': ['没有权限改这个节点（需要网络管理员或节点负责人）', 'You cannot edit this node (network admin or node owner only).'],
  'nodeDesc.notFound': ['Hub 上找不到这个节点', 'The Hub cannot find this node.'],
  'nodeDesc.failed': ['没存上，请重试', 'Not saved. Please retry.'],
} as const;

registerTranslations(nodeDescTranslations);
