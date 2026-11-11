// admin 2026-11-10「fork 到新目录」：新节点放在源目录旁边的 `<源目录>-N`，独立干活。
//
// 走 Hub 的 clone_node(workdir_policy=new_empty)（agent-network #3504）：
//   - daemon 建新目录、只带 AGENTS.md / CLAUDE.md、运行时 / 模型照抄源节点、部门继承源节点；
//   - Claude / Codex / Grok 连会话 transcript 一起复制（真 fork）；
//   - OpenCode 在新目录起新会话（不共享源节点的 transcript）——上下文靠下面这条**交接消息**。
// 同目录接续原会话仍是老的 source fork（NodeSourcePalette 里「同目录」那一档）。
import { cloneNode, fetchHubNodes, fetchTasks, sendTask, type HubConfig, type HubNode, type HubTask } from './api';
import { nodeProviderDaemon } from './node-provider-target';

export type ForkFolder = 'new' | 'same';

export type ForkNewFolderStep =
  | { kind: 'submitting' }
  | { kind: 'creating'; requestId: string }
  | { kind: 'waiting_online'; alias: string }
  | { kind: 'handoff_sent'; alias: string }
  | { kind: 'handoff_failed'; alias: string; error: string };

export function forkNewFolderStepLabel(step: ForkNewFolderStep): string {
  switch (step.kind) {
    case 'submitting': return '正在提交：在源目录旁边新建目录…';
    case 'creating': return 'daemon 正在建目录、写配置、拉起新节点…';
    case 'waiting_online': return `等「${step.alias}」上线…`;
    case 'handoff_sent': return `「${step.alias}」已上线，已把源节点最近的对话交接过去`;
    case 'handoff_failed': return `「${step.alias}」已建好，但交接消息没发出去：${step.error}`;
  }
}

/** Pure. 「目录」那一行的说明：新目录 = 源目录旁边的 `<源目录名>-N`（daemon 从 2 起取第一个空着的号；
 * 源目录名本身以 `-数字` 结尾时从主干往后数，与 agent-node clone-node.ts 的 planCloneWorkdir 同一规则）。 */
export function forkFolderHint(folder: ForkFolder, sourcePath: string | null | undefined): string {
  const path = (sourcePath ?? '').trim().replace(/[\\/]+$/, '');
  if (folder === 'same') return path ? `→ ${path}` : '→ 与源节点同一个目录';
  if (!path) return '→ 源目录旁的 <源目录名>-2（被占用时自动顺延 -3、-4…）';
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const parent = cut >= 0 ? path.slice(0, cut + 1) : '';
  const name = cut >= 0 ? path.slice(cut + 1) : path;
  const stem = name.replace(/-\d+$/, '') || name;
  return `→ ${parent}${stem}-2（被占用时自动顺延 -3、-4…）`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…（已截断）` : s);

/** Pure. 源节点最近的对话（旧 → 新）压成一条交接消息；总长有上限，最老的先丢。 */
export function buildForkHandoff(input: { sourceAlias: string; tasks: readonly HubTask[]; maxChars?: number; perItem?: number }): string {
  const max = input.maxChars ?? 8000;
  const per = input.perItem ?? 700;
  const head = `你是从「${input.sourceAlias}」fork 出来的新节点，在自己的新目录里独立工作（目录里的 AGENTS.md 来自源节点）。\n`
    + `下面是「${input.sourceAlias}」最近的对话（旧 → 新），只作背景：已经做完的不要重做，进行中的事等用户确认再接手。\n`;
  const tail = '\n读完后用一两句话回复：你理解的当前进度，以及你准备接着做什么。';
  const ordered = [...input.tasks]
    .filter(task => (task.content ?? '').trim() || (task.result ?? '').trim())
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  const blocks = ordered.map(task => {
    const ask = (task.content ?? '').trim();
    const ans = (task.result ?? '').trim();
    return [ask ? `【${task.from_name || '用户'}】${clip(ask, per)}` : '', ans ? `【${input.sourceAlias}】${clip(ans, per)}` : ''].filter(Boolean).join('\n');
  });
  const kept: string[] = [];
  let used = head.length + tail.length;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const cost = blocks[i].length + 2;
    if (used + cost > max) break;
    kept.unshift(blocks[i]);
    used += cost;
  }
  if (!kept.length) return `${head}（源节点最近没有可交接的对话）${tail}`;
  const dropped = blocks.length - kept.length;
  return `${head}${dropped > 0 ? `（更早的 ${dropped} 轮已省略）\n` : ''}\n${kept.join('\n\n')}\n${tail}`;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** clone_node(new_empty) → 等新节点在 Hub 上出现 → 发交接消息。`live()` 为 false（弹窗关了）就停。 */
export async function runForkToNewFolder(cfg: HubConfig, input: {
  sourceNodeId: string;
  sourceAlias: string;
  name: string;
  onStep: (step: ForkNewFolderStep) => void;
  live: () => boolean;
  pollMs?: number;
  onlineTimeoutMs?: number;
}): Promise<{ ok: true; alias: string; handoff: boolean } | { ok: false; error: string }> {
  input.onStep({ kind: 'submitting' });
  const nodes = await fetchHubNodes(cfg);
  const source = nodes.nodes.find((node: HubNode) => node.node_id === input.sourceNodeId);
  const daemon = source ? nodeProviderDaemon(source) : null;
  if (!daemon) return { ok: false, error: '源节点不归任何 daemon 管（未创建自 daemon，也未被收编），不能 fork 到新目录' };
  const cloned = await cloneNode(cfg, {
    daemon_node_id: daemon, source_node_id: input.sourceNodeId, name: input.name,
    copy_session: true, workdir_policy: 'new_empty',
  });
  if (!cloned.ok) {
    const why = 'unsupported' in cloned && cloned.unsupported ? '这个 Hub 还不支持 clone_node' : ('error' in cloned ? cloned.error : 'clone_node 失败');
    return { ok: false, error: why };
  }
  const alias = cloned.child_name;
  input.onStep({ kind: 'creating', requestId: cloned.request_id });
  const deadline = Date.now() + (input.onlineTimeoutMs ?? 3 * 60_000);
  input.onStep({ kind: 'waiting_online', alias });
  for (;;) {
    if (!input.live()) return { ok: true, alias, handoff: false };
    const found = (await fetchHubNodes(cfg).catch(() => ({ nodes: [] as HubNode[] }))).nodes.some(node => node.alias === alias);
    if (found) break;
    if (Date.now() >= deadline) return { ok: false, error: `「${alias}」3 分钟内没有上线；daemon 日志里搜 clone-node 看原因` };
    await sleep(input.pollMs ?? 4000);
  }
  try {
    const recent = await fetchTasks(cfg, { to_name: input.sourceAlias, limit: 12, skipStats: true }).catch(() => ({ tasks: [] as HubTask[] }));
    await sendTask(cfg, alias, buildForkHandoff({ sourceAlias: input.sourceAlias, tasks: recent.tasks ?? [] }));
    input.onStep({ kind: 'handoff_sent', alias });
    return { ok: true, alias, handoff: true };
  } catch (error) {
    input.onStep({ kind: 'handoff_failed', alias, error: String((error as Error)?.message ?? error) });
    return { ok: true, alias, handoff: false };
  }
}
