// 设置里看节点的「技能」(只读)—— 位于「节点规则」下方,详情页和只读页都显示。
//
// 数据流与节点规则同一条门铃:listNodeSkills / readNodeSkill → hub 落
// node_rules_requests(op=skills_list / skill_read)+ 门铃 → 节点按自己运行时
// 真正加载技能的目录枚举 → waitForRulesFileResult 轮询到终态。
// 🔴 只传技能名,不传路径;目录由节点决定。会话没上报 skills_capable 就不显示。

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';

import { listNodeSkills, readNodeSkill, waitForRulesFileResult, type HubConfig, type RulesTarget, type Session } from './api';
import MarkdownMessage from './MarkdownMessage';
import { isTerminal, nextPollDelayMs, requestIdToFollow } from './node-rules';
import { parseSkillDetail, parseSkillsList, scopeLabel, skillsStatusMessage, skillsTarget, stripFrontmatter, type SkillDetail, type SkillSummary } from './node-skills';
import { colors, radius, spacing, type, weight } from './theme';

type Phase = 'loading' | 'ready' | 'unavailable';
const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

export type NodeSkillsSectionProps = { cfg: HubConfig; alias?: string; node?: RulesTarget | null; session: Session; readOnly?: boolean };

export function NodeSkillsSection({ cfg, alias, node, session }: NodeSkillsSectionProps) {
  // 技能区块本身就是只读的,readOnly 页和详情页行为一致。节点页有 nodes 行时传 node(按 node_id 发),
  // 没有时退到 alias(claude-code 会话)。
  const target = skillsTarget({ node: node ?? null, session: { ...session, alias: session.alias || alias || '' } });
  if (!target) return null;
  return <SkillsCard cfg={cfg} target={target} />;
}

function SkillsCard({ cfg, target }: { cfg: HubConfig; target: RulesTarget }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [detailMsg, setDetailMsg] = useState('');
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);
  const key = `${target.node_id ?? ''}|${target.alias}`;

  const wait = (id: string) => waitForRulesFileResult(cfg, id, { nextDelayMs: nextPollDelayMs, isTerminal, isCancelled: () => cancelled.current });

  const runList = useCallback(async () => {
    setPhase('loading');
    setMessage(skillsStatusMessage('pending', null));
    const enq = await listNodeSkills(cfg, target);
    if (cancelled.current) return;
    const follow = requestIdToFollow(enq);
    if (!follow) { setPhase('unavailable'); setMessage(enq.ok ? '' : enq.error); return; }
    const res = await wait(follow);
    if (cancelled.current) return;
    if (!res.ok) { setPhase('unavailable'); setMessage(res.error); return; }
    if (res.status !== 'done') { setPhase('unavailable'); setMessage(skillsStatusMessage(res.status, res.error)); return; }
    const list = parseSkillsList(res.content);
    setSkills(list);
    setPhase('ready');
    setMessage(skillsStatusMessage('done', null, list.length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, key]);

  useEffect(() => { void runList(); }, [runList]);

  const toggle = async (name: string) => {
    if (open === name) { setOpen(null); setDetail(null); return; }
    setOpen(name); setDetail(null); setDetailMsg('正在读取 SKILL.md…');
    const enq = await readNodeSkill(cfg, target, name);
    if (cancelled.current) return;
    if (!enq.ok) {
      // 单飞:上一条还没做完就先等它,再提示重点一次(不把「等一下」说成失败)。
      const follow = requestIdToFollow(enq);
      if (follow) { await wait(follow); if (cancelled.current) return; setDetailMsg('上一条请求已结束,请再点一次'); setOpen(null); return; }
      setDetailMsg(enq.error); return;
    }
    const res = await wait(enq.request_id);
    if (cancelled.current) return;
    if (!res.ok) { setDetailMsg(res.error); return; }
    if (res.status !== 'done') { setDetailMsg(skillsStatusMessage(res.status, res.error)); return; }
    const d = parseSkillDetail(res.content);
    if (!d) { setDetailMsg('节点返回的技能内容无法解析'); return; }
    setDetail(d); setDetailMsg('');
  };

  return (
    // 标题由节点页的 SectionTitle「技能」给出(2026-09-24 节点页重做),这里不再重复。
    <View>
      <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md }}>
        <Text style={{ color: colors.textMuted, fontSize: type.small, lineHeight: 18 }}>
          {phase === 'ready' ? `共 ${skills.length} 个 · ` : ''}SKILL.md 所在目录由节点按自己的运行时决定,这里只能查看,不能修改。
        </Text>
        {phase === 'loading' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <ActivityIndicator color={colors.accent} />
            <Text style={{ color: colors.textMuted, fontSize: type.small }}>{message}</Text>
          </View>
        ) : null}
        {phase === 'unavailable' ? <Text style={{ color: colors.failed, fontSize: type.small, lineHeight: 18 }}>{message}</Text> : null}
        {phase === 'ready' && skills.length === 0 ? <Text style={{ color: colors.textMuted, fontSize: type.small }}>{message}</Text> : null}
        {phase === 'ready' && skills.length > 0 ? (
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
            {skills.map(sk => (
              <View key={`${sk.scope}:${sk.name}`} style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open === sk.name }}
                  onPress={() => void toggle(sk.name)}
                  style={({ pressed }) => ({ paddingVertical: spacing.md, gap: 4, backgroundColor: pressed || open === sk.name ? colors.rowHover : 'transparent', paddingHorizontal: spacing.sm, borderRadius: radius.sm })}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Text style={{ color: colors.text, fontSize: type.body, fontWeight: weight.strong, fontFamily: mono, flexShrink: 1 }} numberOfLines={1}>{sk.name}</Text>
                    <View style={{ backgroundColor: colors.subtleFill, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 }}>
                      <Text style={{ color: colors.textSecondary, fontSize: type.caption }}>{scopeLabel(sk.scope)}</Text>
                    </View>
                    <View style={{ flex: 1 }} />
                    <Text style={{ color: colors.textMuted, fontSize: type.small }}>{open === sk.name ? '收起' : '查看'}</Text>
                  </View>
                  {sk.description ? <Text style={{ color: colors.textSecondary, fontSize: type.small, lineHeight: 18 }} numberOfLines={open === sk.name ? undefined : 2}>{sk.description}</Text> : null}
                </Pressable>
                {open === sk.name ? (
                  <View style={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.md, gap: spacing.sm }}>
                    <Text style={{ color: colors.textMuted, fontSize: type.caption, fontFamily: mono }} selectable>{detail?.path_rel ?? sk.path_rel}</Text>
                    {detail ? (
                      <View style={{ backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md }}>
                        <MarkdownMessage>{stripFrontmatter(detail.content)}</MarkdownMessage>
                      </View>
                    ) : (
                      <Text style={{ color: /失败|无法|没有响应|还没有技能查看/.test(detailMsg) ? colors.failed : colors.textMuted, fontSize: type.small }}>{detailMsg}</Text>
                    )}
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <Pressable style={{ paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, opacity: phase === 'loading' ? 0.4 : 1 }} disabled={phase === 'loading'} onPress={() => { setOpen(null); setDetail(null); void runList(); }}>
            <Text style={{ color: colors.text, fontSize: type.small }}>刷新</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default NodeSkillsSection;
