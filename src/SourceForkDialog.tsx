// #4150 受管 source 独立 fork（gated preview）—— 浮层版本。
//
// 合同见 docs/runbooks/session-source-transport.md：只 managed source → independent fork，
// 404 = gate 未开放（不 fallback 普通创建），unknown 用同一 intent 重试、不新开意图。
//
// 界面不再是老式分步表单：与 #4130 模型命令面板同一套浮层（搜索 / 分组计数 / 当前项 ✓ /
// 紧凑确认区），新建会话 / 接入已有会话 / fork 三种提交体都由 session-*-*.ts 的构造器产生，
// 字段名与互斥规则逐字沿用。逻辑见 NodeSourcePalette.tsx 与 node-source-palette.ts。
import type { HubConfig } from './api';
import NodeSourcePalette from './NodeSourcePalette';
import type { ForkCandidate } from './node-source-palette';

export default function SourceForkDialog({
  cfg, sourceNodeId, networkId, sessionId: presetSession, forkSessions, onClose,
}: {
  cfg: HubConfig;
  sourceNodeId: string;
  networkId: string | null;
  sessionId: string | null;
  /** 调用方手上已有的受管会话名单（可选）；不给就由浮层读 full /api/status。 */
  forkSessions?: readonly ForkCandidate[];
  onClose: () => void;
}) {
  return (
    <NodeSourcePalette
      cfg={cfg}
      sourceNodeId={sourceNodeId}
      networkId={networkId}
      sessionId={presetSession}
      forkSessions={forkSessions}
      onClose={onClose}
    />
  );
}
