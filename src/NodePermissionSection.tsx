// 节点页「权限」分区(board #489,Hub RFC-041 + 收件白名单)。两张卡:
//   发  权限模式(正常 / 只读 / 受限)+「可以发给」名单 + 可用工具(高级,收起);
//   收  「接受来自」名单 —— 只在 /health 报了 node_inbox_allowlist 的 Hub 上出现(旧 Hub 没有这个接口)。
// 外加「被拒绝时会看到什么」和「过去 7 天本来会拦下 N 次」。
//
// 模式两套布局(node-permission-model.ts permissionLayout):
//   桌面  一行三段的分段控件 + 下面一句选中项的说明;
//   手机  三张竖排的选项卡(单选圆点 + 名字 + 一句说明),整张卡可点,高度 ≥ 64。
// 谁能看到这个分区由 Hub 决定(viewer_can.permission_mode),这里不再判权限。
// 改了立刻 PUT;失败回到原来的值并说明原因(node_permission_denied 带原因码和 Hub 的 hint)。
// 名单里的节点从网络的节点列表里勾,手填只是补充。报表只有网络 owner / admin 读得到(别人 403 ⇒ 不显示那一行)。
//
// 样式约定同 NodeModelSection:colors 用 live binding、不解构;卡片 colors.card / radius.surface / spacing.lg。
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text, TextInput } from './ui-text';

import {
  INBOX_ALLOWLIST_CAPABILITY, fetchHubHealthCapabilities, fetchHubNodes, fetchNodePermissionReport,
  putNodeInboxAllowlist, putNodePeerAllowlist, putNodePermissionMode, putNodeToolAllowlist, type HubConfig, type HubNode,
} from './api';
import { fetchHumans } from './human-dm-api';
import { fetchOrg } from './org-api';
import type { Human } from './human-dm';
import {
  ALWAYS_TOOLS, ANY_PERSON_ENTRY, INBOX_DEPT_CAPABILITY, deptChoices, deptEntry, type DeptChoice, PERMISSION_REASON_CODES, allowlistErrorText, allowlistText, entryLabel, isAlwaysTool, isStrict,
  listHasNode, mergeDraft, nodeChoices, normalizeInbox, parseAllowlistInput, permissionReasonText, personEntry, senderEntries,
  setStrict, toggleEntry, toggleNode, withoutAlwaysTools, withoutItem, type NodeChoice,
} from './node-allowlist-model';
import { Ionicons } from './icons';
import {
  normalizeMode,
  nodePermissionOptions,
  optionFor,
  permissionLayout,
  reportFootnote,
  reportHeadline,
  saveErrorText,
  shouldSubmit,
  summarizeReport,
  supportsInboxAllowlist,
  type NodePermissionMode,
  type ReportSummary,
} from './node-permission-model';
import { useTranslation } from './i18n-react';
import './i18n-node-permissions';
import { colors, radius, spacing, type as typeScale, weight } from './theme';

type ListKind = 'peer' | 'inbox' | 'tool';
type ListStatus = { error?: string; note?: string };

export default function NodePermissionSection({ cfg, node, compact, onChanged }: {
  cfg: HubConfig;
  node: HubNode;
  compact: boolean;
  onChanged?: (mode: NodePermissionMode) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<NodePermissionMode>(normalizeMode(node.permission_mode));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedNote, setSavedNote] = useState('');
  // undefined = 读取中;null = 读不到(不是 owner / admin,或旧 Hub)⇒ 不显示报表行
  const [report, setReport] = useState<ReportSummary | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  // 三张名单:null = 不限制(Hub 不收 [],见 node-allowlist-model)。
  const [peers, setPeers] = useState<string[] | null>(node.peer_allowlist ?? null);
  const [tools, setTools] = useState<string[] | null>(node.tool_allowlist ?? null);
  const [inbox, setInbox] = useState<string[] | null>(node.inbox_allowlist ?? null);
  const [status, setStatus] = useState<Record<ListKind, ListStatus>>({ peer: {}, inbox: {}, tool: {} });
  /** 「被拒绝时会看到什么」的展开状态:原因码指向不同排查动作,合并成「权限不足」会误导。 */
  const [reasonOpen, setReasonOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(!!node.tool_allowlist?.length);
  /** 名单候选:这个网络的节点列表(比手打别名可靠)。 */
  const [choices, setChoices] = useState<NodeChoice[]>([]);
  const [humans, setHumans] = useState<Human[]>([]);
  /** Hub 有没有收件白名单(/health capabilities)。undefined = 还在读 ⇒ 先不画「收」。 */
  const [inboxSupported, setInboxSupported] = useState<boolean | undefined>(undefined);
  /** 部门授权(Hub 报 node_inbox_allowlist_dept 才画)。admin 11-11「以部门去授权」。 */
  const [deptSupported, setDeptSupported] = useState(false);
  const [depts, setDepts] = useState<DeptChoice[]>([]);

  useEffect(() => { setMode(normalizeMode(node.permission_mode)); }, [node.node_id, node.permission_mode]);
  useEffect(() => {
    let alive = true;
    void fetchHubNodes(cfg)
      .then(r => { if (alive) setChoices(nodeChoices(r.nodes ?? [], node)); })
      .catch(() => { if (alive) setChoices([]); });
    void fetchHubHealthCapabilities(cfg).then(caps => { if (alive) { setInboxSupported(supportsInboxAllowlist(caps, INBOX_ALLOWLIST_CAPABILITY)); setDeptSupported(caps.includes(INBOX_DEPT_CAPABILITY)); } });
    return () => { alive = false; };
  }, [cfg, node.node_id, node.alias]);
  useEffect(() => {
    if (!inboxSupported || !cfg.networkId) return;
    let alive = true;
    void fetchHumans(cfg, cfg.networkId).then(h => { if (alive) setHumans(h); }).catch(() => { if (alive) setHumans([]); });
    if (deptSupported) void fetchOrg(cfg, cfg.networkId).then(o => { if (alive) setDepts(deptChoices(o?.departments ?? [])); }).catch(() => { if (alive) setDepts([]); });
    return () => { alive = false; };
  }, [cfg, inboxSupported, deptSupported]);

  useEffect(() => {
    setPeers(node.peer_allowlist ?? null);
    setTools(node.tool_allowlist ?? null);
    setInbox(node.inbox_allowlist ?? null);
    setStatus({ peer: {}, inbox: {}, tool: {} });
  }, [node.node_id, node.peer_allowlist, node.tool_allowlist, node.inbox_allowlist]);

  /** 提交一张名单。成功以 Hub 回的那一份为准;失败保持原值并说明原因。 */
  const saveList = async (kind: ListKind, next: string[] | null): Promise<boolean> => {
    if (busy) return false;
    // 工具:只填了保活类时过滤后为空,语义就是「不限制」(保活类本来就不可禁用)⇒ 按 null 提交。
    const submit = kind === 'tool' ? (next === null ? null : withoutAlwaysTools(next))
      : kind === 'inbox' ? normalizeInbox(next) : next;
    const safe = submit && submit.length ? submit : null;
    setBusy(true);
    setStatus(s => ({ ...s, [kind]: {} }));
    const res = kind === 'peer' ? await putNodePeerAllowlist(cfg, node.node_id, safe)
      : kind === 'inbox' ? await putNodeInboxAllowlist(cfg, node.node_id, safe)
      : await putNodeToolAllowlist(cfg, node.node_id, safe);
    setBusy(false);
    if (!res.ok) { setStatus(s => ({ ...s, [kind]: { error: allowlistErrorText(res) } })); return false; }
    const saved = 'peers' in res ? res.peers : 'senders' in res ? res.senders : res.tools;
    (kind === 'peer' ? setPeers : kind === 'inbox' ? setInbox : setTools)(saved);
    const note = saved === null ? t('nodePerm.list.cleared') : t(kind === 'peer' ? 'nodePerm.peers.saved' : kind === 'inbox' ? 'nodePerm.inbox.saved' : 'nodePerm.tools.saved');
    setStatus(s => ({ ...s, [kind]: { note } }));
    return true;
  };

  useEffect(() => {
    let alive = true;
    void fetchNodePermissionReport(cfg).then(r => { if (alive) setReport(summarizeReport(r, node.node_id)); });
    return () => { alive = false; };
  }, [cfg, node.node_id]);

  const pick = async (next: NodePermissionMode) => {
    if (!shouldSubmit(mode, next, busy)) return;
    const previous = mode;
    setMode(next);
    setBusy(true);
    setError('');
    setSavedNote('');
    const res = await putNodePermissionMode(cfg, node.node_id, next);
    setBusy(false);
    if (!res.ok) {
      setMode(previous);
      setError(saveErrorText(res));
      return;
    }
    setSavedNote(t('nodePerm.mode.saved', { mode: optionFor(next).label }));
    onChanged?.(next);
  };

  const layout = permissionLayout(compact);
  const options = nodePermissionOptions();
  const selected = optionFor(mode);
  const label = (e: string) => entryLabel(e, choices, humans, depts);
  const showInbox = inboxSupported === true;
  const strict = isStrict(inbox);
  const card = { backgroundColor: colors.card, borderRadius: radius.surface, padding: spacing.lg, gap: spacing.md } as const;

  return (
    <View style={{ paddingTop: spacing.xl, gap: spacing.md }} testID="node-perm-section">
      <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>{t('nodePerm.intro')}</Text>

      {/* 一行摘要:模式 + 名单,不用展开就知道当前限制到什么程度。 */}
      <Text style={{ color: colors.textSecondary, fontSize: typeScale.small, lineHeight: 18 }} testID="node-perm-overview">
        {showInbox
          ? t('nodePerm.overview', { mode: selected.label, peers: allowlistText(peers, label), inbox: allowlistText(inbox, label), tools: allowlistText(tools) })
          : t('nodePerm.overviewNoInbox', { mode: selected.label, peers: allowlistText(peers, label), tools: allowlistText(tools) })}
      </Text>

      {/* ── 发 ── */}
      <View style={card} testID="node-perm-send">
        <CardHeader icon="arrow-up-circle-outline" title={t('nodePerm.send.title')} hint={t('nodePerm.send.hint')} />
        <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>{t('nodePerm.mode.label')}</Text>
        {layout === 'segmented' ? (
          <View style={{ gap: spacing.md }} testID="node-perm-segmented">
            <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, overflow: 'hidden', alignSelf: 'flex-start' }}>
              {options.map((o, i) => {
                const active = o.mode === mode;
                return (
                  <Pressable
                    key={o.mode}
                    testID={`node-perm-option-${o.mode}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active, disabled: busy }}
                    aria-checked={active}
                    accessibilityLabel={t('nodePerm.mode.option', { label: o.label, summary: o.summary })}
                    disabled={busy}
                    onPress={() => void pick(o.mode)}
                    style={({ pressed }) => [
                      { minWidth: 96, height: 36, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? colors.accent : colors.card },
                      i > 0 && { borderLeftWidth: 1, borderLeftColor: colors.border },
                      pressed && !active && { backgroundColor: colors.rowHover },
                    ]}
                  >
                    <Text style={{ color: active ? colors.onAccent : colors.text, fontSize: typeScale.body, fontWeight: active ? weight.strong : weight.regular }}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={{ color: colors.text, fontSize: typeScale.body, lineHeight: 20 }} testID="node-perm-summary">{selected.summary}</Text>
          </View>
        ) : (
          <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }} testID="node-perm-cards">
            {options.map(o => {
              const active = o.mode === mode;
              return (
                <Pressable
                  key={o.mode}
                  testID={`node-perm-option-${o.mode}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active, disabled: busy }}
                  aria-checked={active}
                  accessibilityLabel={t('nodePerm.mode.option', { label: o.label, summary: o.summary })}
                  disabled={busy}
                  onPress={() => void pick(o.mode)}
                  style={({ pressed }) => [
                    { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.subtleFill, borderRadius: radius.surface, borderWidth: 1, borderColor: active ? colors.accent : colors.border },
                    pressed && { backgroundColor: colors.rowHover },
                  ]}
                >
                  <View style={{ width: 20, height: 20, borderRadius: radius.pill, borderWidth: 2, borderColor: active ? colors.accent : colors.textMuted, alignItems: 'center', justifyContent: 'center' }}>
                    {active ? <View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.accent }} /> : null}
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={{ color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong }}>{o.label}</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: typeScale.small, lineHeight: 18 }} testID={`node-perm-option-${o.mode}-summary`}>{o.summary}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
        {error ? <Text style={{ color: colors.failed, fontSize: typeScale.small }} testID="node-perm-error">{error}</Text> : null}
        {savedNote && !error ? <Text style={{ color: colors.running, fontSize: typeScale.small }} testID="node-perm-saved">{savedNote}</Text> : null}

        <Divider />
        <AllowlistEditor kind="peer" title={t('nodePerm.peers.title')} hint={t('nodePerm.peers.hint')} placeholder={t('nodePerm.peers.placeholder')}
          list={peers} label={label} busy={busy} status={status.peer} onSave={next => saveList('peer', next)}
          picks={choices.length ? <NodePicks testPrefix="node-peer-allowlist-pick" choices={choices} list={peers} busy={busy} onToggle={c => void saveList('peer', toggleNode(peers, c))} /> : null} />

        <Divider />
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: toolsOpen }} testID="node-tool-allowlist-toggle"
          onPress={() => setToolsOpen(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: compact ? 44 : 28 }}>
          <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong }}>{t('nodePerm.tools.toggle')}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: typeScale.small }} numberOfLines={1}>{allowlistText(tools)}</Text>
          <Ionicons name={toolsOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
        </Pressable>
        {toolsOpen ? (
          <AllowlistEditor kind="tool" hint={t('nodePerm.tools.hint')} placeholder={t('nodePerm.tools.placeholder')}
            list={tools} label={e => e} busy={busy} status={status.tool} onSave={next => saveList('tool', next)}
            blockDraft={draft => {
              const always = parseAllowlistInput(draft)?.filter(isAlwaysTool) ?? [];
              return always.length ? t('nodePerm.tools.alwaysError', { tools: always.join(', ') }) : '';
            }}
            footer={<Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }} testID="node-tool-allowlist-always">{t('nodePerm.tools.always', { tools: ALWAYS_TOOLS.join(', ') })}</Text>} />
        ) : null}
      </View>

      {/* ── 收 ── 旧 Hub 没有收件白名单 ⇒ 整张卡不出现(不画一个存不进去的表单)。 */}
      {showInbox ? (
        <View style={card} testID="node-perm-receive">
          <CardHeader icon="arrow-down-circle-outline" title={t('nodePerm.receive.title')} hint={t('nodePerm.receive.hint')} />
          <AllowlistEditor kind="inbox" title={t('nodePerm.inbox.title')} hint={t('nodePerm.inbox.hint')} placeholder={t('nodePerm.inbox.placeholder')}
            list={inbox} label={label} busy={busy} status={status.inbox} onSave={next => saveList('inbox', next)}
            picks={(
              <View style={{ gap: spacing.sm }}>
                {choices.length ? <NodePicks testPrefix="node-inbox-allowlist-pick" choices={choices} list={inbox} busy={busy} onToggle={c => void saveList('inbox', toggleNode(inbox, c))} /> : null}
                {deptSupported && depts.length ? (
                  <View style={{ gap: 6 }}>
                    <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>{t('nodePerm.inbox.depts')}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} testID="node-inbox-allowlist-depts">
                      {depts.map(d => {
                        const entry = deptEntry(d.id);
                        const on = !!inbox?.includes(entry);
                        return <PickChip key={d.id} testID={`node-inbox-allowlist-dept-${d.id}`} text={d.path} on={on} busy={busy}
                          onPress={() => void saveList('inbox', toggleEntry(inbox, entry))} />;
                      })}
                    </View>
                  </View>
                ) : null}
                <View style={{ gap: 6 }}>
                  <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>{t('nodePerm.inbox.people')}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} testID="node-inbox-allowlist-people">
                    <PickChip testID="node-inbox-allowlist-person-any" text={t('nodePerm.inbox.anyPerson')} on={!!inbox?.includes(ANY_PERSON_ENTRY)} busy={busy}
                      onPress={() => void saveList('inbox', toggleEntry(inbox, ANY_PERSON_ENTRY))} />
                    {humans.map(h => {
                      const entry = personEntry(h.username);
                      const on = !!inbox?.some(e => e === entry || e === `user:${h.user_id}`);
                      return <PickChip key={h.user_id} testID={`node-inbox-allowlist-person-${h.username}`} text={h.display_name || h.username} on={on} busy={busy}
                        onPress={() => void saveList('inbox', on ? withoutItem(inbox ?? [], entry, `user:${h.user_id}`) : [...(inbox ?? []), entry])} />;
                    })}
                  </View>
                </View>
              </View>
            )}
            footer={(
              <View style={{ gap: spacing.sm }}>
                <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }} testID="node-inbox-allowlist-bypass">
                  {strict ? t('nodePerm.inbox.strictOn') : t('nodePerm.inbox.bypass')}
                </Text>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: strict, disabled: busy || !senderEntries(inbox).length }} aria-checked={strict}
                  testID="node-inbox-allowlist-strict" disabled={busy || !senderEntries(inbox).length}
                  onPress={() => void saveList('inbox', setStrict(inbox, !strict))}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: compact ? 44 : 28, opacity: senderEntries(inbox).length ? 1 : 0.5 }}>
                  <Ionicons name={strict ? 'checkbox' : 'square-outline'} size={18} color={strict ? colors.accent : colors.textMuted} />
                  <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.small }}>{t('nodePerm.inbox.strict')}</Text>
                </Pressable>
                {!senderEntries(inbox).length ? <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>{t('nodePerm.inbox.strictNeedsList')}</Text> : null}
              </View>
            )} />
        </View>
      ) : null}

      {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}

      {/* 原因码说明:每个码的排查动作完全不同,摊开写清楚,别让人以为都是「权限不足」。 */}
      <View style={{ backgroundColor: colors.card, borderRadius: radius.surface, overflow: 'hidden' }}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: reasonOpen }} testID="node-perm-reasonhelp-toggle"
          onPress={() => setReasonOpen(v => !v)}
          style={({ pressed }) => [{ minHeight: compact ? 52 : 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg }, pressed && { backgroundColor: colors.rowHover }]}>
          <Ionicons name="help-circle-outline" size={18} color={colors.textMuted} />
          <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.body }}>{t('nodePerm.reasonHelp.toggle')}</Text>
          <Ionicons name={reasonOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
        </Pressable>
        {reasonOpen ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm }} testID="node-perm-reasonhelp">
            {PERMISSION_REASON_CODES.filter(code => showInbox || code !== 'sender_not_allowed').map(code => (
              <View key={code} style={{ gap: 2 }} testID={`node-perm-reasonhelp-${code}`}>
                <Text style={{ color: colors.textSecondary, fontSize: typeScale.small, fontFamily: 'monospace' }}>{code}</Text>
                <Text style={{ color: colors.text, fontSize: typeScale.small, lineHeight: 18 }}>{permissionReasonText(code)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {report ? (
        <View style={{ backgroundColor: colors.card, borderRadius: radius.surface, overflow: 'hidden' }}>
          <Pressable
            testID="node-perm-report"
            accessibilityRole="button"
            accessibilityState={{ expanded: open, disabled: report.total === 0 }}
            disabled={report.total === 0}
            onPress={() => setOpen(v => !v)}
            style={({ pressed }) => [{ minHeight: compact ? 52 : 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg }, pressed && { backgroundColor: colors.rowHover }]}
          >
            <Ionicons name="shield-checkmark-outline" size={18} color={report.total > 0 ? colors.accent : colors.textMuted} />
            <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.body }} testID="node-perm-report-headline">{reportHeadline(report)}</Text>
            {report.total > 0 ? <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} /> : null}
          </Pressable>
          {open && report.total > 0 ? (
            <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md }} testID="node-perm-report-detail">
              <View style={{ gap: spacing.xs }}>
                <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>{t('nodePerm.report.byReason')}</Text>
                {report.byReason.map(r => (
                  <View key={r.reason} style={{ flexDirection: 'row', gap: spacing.md }} testID={`node-perm-reason-${r.reason}`}>
                    <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.small, lineHeight: 18 }}>{r.label}</Text>
                    <Text style={{ color: colors.text, fontSize: typeScale.small, fontWeight: weight.strong }}>{t('nodePerm.report.hits', { count: r.hits })}</Text>
                  </View>
                ))}
              </View>
              <View style={{ gap: spacing.xs }}>
                <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>{t('nodePerm.report.byRoute')}</Text>
                {report.byRoute.map(r => (
                  <View key={`${r.route}|${r.reason}`} style={{ flexDirection: 'row', gap: spacing.md }} testID="node-perm-route">
                    <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.small, lineHeight: 18 }} numberOfLines={2}>{r.label}</Text>
                    <Text style={{ color: colors.text, fontSize: typeScale.small, fontWeight: weight.strong }}>{t('nodePerm.report.hits', { count: r.hits })}</Text>
                  </View>
                ))}
              </View>
              <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }} testID="node-perm-report-footnote">{reportFootnote(report)}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.border }} />;
}

function CardHeader({ icon, title, hint }: { icon: 'arrow-up-circle-outline' | 'arrow-down-circle-outline'; title: string; hint: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={20} color={colors.accent} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong }}>{title}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: typeScale.small, lineHeight: 18 }}>{hint}</Text>
      </View>
    </View>
  );
}

function PickChip({ testID, text, on, busy, onPress }: { testID: string; text: string; on: boolean; busy: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: busy }} aria-checked={on} disabled={busy} testID={testID} onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.accent : colors.border }}>
      <Ionicons name={on ? 'checkmark' : 'add'} size={12} color={on ? colors.accent : colors.textMuted} />
      <Text style={{ color: colors.text, fontSize: typeScale.small }}>{text}</Text>
    </Pressable>
  );
}

/** 从网络的节点列表里勾选(展开 / 收起)。 */
function NodePicks({ testPrefix, choices, list, busy, onToggle }: { testPrefix: string; choices: readonly NodeChoice[]; list: string[] | null; busy: boolean; onToggle: (c: NodeChoice) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} testID={`${testPrefix}-toggle`}
        onPress={() => setOpen(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}>
        <Text style={{ color: colors.accent, fontSize: typeScale.small }}>{open ? t('nodePerm.list.pickClose') : t('nodePerm.list.pickOpen')}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={13} color={colors.accent} />
      </Pressable>
      {open ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} testID={testPrefix}>
          {choices.map(c => <PickChip key={c.node_id} testID={`${testPrefix}-${c.key}`} text={c.key} on={listHasNode(list, c)} busy={busy} onPress={() => onToggle(c)} />)}
        </View>
      ) : null}
    </View>
  );
}

/** 一张名单:当前值 + 可删的 chip + 候选 + 手填补充 + 清空。null = 不限制。 */
function AllowlistEditor({ kind, title, hint, placeholder, list, label, busy, status, onSave, picks, footer, blockDraft }: {
  kind: ListKind;
  title?: string;
  hint: string;
  placeholder: string;
  list: string[] | null;
  label: (entry: string) => string;
  busy: boolean;
  status: ListStatus;
  onSave: (next: string[] | null) => Promise<boolean>;
  picks?: ReactNode;
  footer?: ReactNode;
  blockDraft?: (draft: string) => string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const blocked = blockDraft?.(draft) ?? '';
  const entries = senderEntries(list);
  const id = `node-${kind}-allowlist`;
  const add = async () => { if (await onSave(mergeDraft(list, draft))) setDraft(''); };
  return (
    <View style={{ gap: spacing.sm }} testID={`${id}-card`}>
      <View style={{ gap: 2 }}>
        {title ? <Text style={{ color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong }}>{title}</Text> : null}
        <Text style={{ color: colors.textSecondary, fontSize: typeScale.small, lineHeight: 18 }}>{hint}</Text>
        <Text style={{ color: colors.text, fontSize: typeScale.small, lineHeight: 18 }} testID={`${id}-value`}>
          {t('nodePerm.list.current', { value: allowlistText(list, label) })}
        </Text>
        {/* 已设置的条目做成可删的 chip:手打错一个不用整串重输。 */}
        {entries.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {entries.map(e => (
              <Pressable key={e} accessibilityRole="button" accessibilityLabel={t('nodePerm.list.remove', { item: label(e) })} disabled={busy}
                testID={`${id}-remove-${e}`} onPress={() => void onSave(withoutItem(list ?? [], e))}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.subtleFill }}>
                <Text style={{ color: colors.text, fontSize: typeScale.small }}>{label(e)}</Text>
                <Ionicons name="close" size={12} color={colors.textMuted} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      {picks}
      <TextInput value={draft} onChangeText={setDraft} placeholder={placeholder}
        placeholderTextColor={colors.textMuted} autoCapitalize="none" testID={`${id}-input`} onSubmitEditing={() => { if (!blocked && parseAllowlistInput(draft)) void add(); }}
        style={{ color: colors.text, fontSize: typeScale.small, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: spacing.sm, paddingVertical: 6 }} />
      {blocked ? <Text style={{ color: colors.failed, fontSize: typeScale.small }} testID={`${id}-always-error`}>{blocked}</Text> : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Pressable accessibilityRole="button" testID={`${id}-save`} disabled={busy || !!blocked || !parseAllowlistInput(draft)}
          onPress={() => void add()}
          style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.accent, opacity: blocked || !parseAllowlistInput(draft) ? 0.5 : 1 }}>
          <Text style={{ color: colors.onAccent, fontSize: typeScale.small, fontWeight: weight.strong }}>{t('nodePerm.list.add')}</Text>
        </Pressable>
        {list?.length ? (
          <Pressable accessibilityRole="button" testID={`${id}-clear`} disabled={busy}
            onPress={() => { setDraft(''); void onSave(null); }}
            style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.md }}>
            <Text style={{ color: colors.accent, fontSize: typeScale.small }}>{t('nodePerm.list.clear')}</Text>
          </Pressable>
        ) : null}
      </View>
      {footer}
      {status.error ? <Text style={{ color: colors.failed, fontSize: typeScale.small, lineHeight: 18 }} testID={`${id}-error`}>{status.error}</Text> : null}
      {status.note && !status.error ? <Text style={{ color: colors.running, fontSize: typeScale.small }} testID={`${id}-saved`}>{status.note}</Text> : null}
    </View>
  );
}
