// 任务详情里的「评论」(#474,Hub ≥ preview.90):Agent 经 MCP requirements_comment、人经 REST 发的评论 / 进展,
// 存在 Hub 的任务动态里(GET /api/requirements/events?requirement_id=,kind = comment,正文 new.text)。
// 这里只读:按时间从旧到新,最多先显示最近 COMMENTS_SHOWN 条,更早的点一下展开。
// 旧 Hub 没有评论(或没有动态接口):读不到 / 没有评论就什么都不画,详情和以前一样。
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Text } from './ui-text';
import MarkdownMessage from './MarkdownMessage';
import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-tasks';
import { colors, spacing, type as typeScale, weight } from './theme';
import type { HubConfig } from './api';
import type { RequirementPerson } from './requirement-people';
import { fetchRequirementEvents } from './requirements-hub';
import { parseEvents } from './task-activity-model';
import { cardComments, COMMENTS_SHOWN, type CardComment } from './task-comments-model';
import { personDisplay } from './i18n-task-presentation';
import { pointerUi } from './pointer-ui';
import { usePoll } from './usePoll';

/** 详情开着时多久再读一次(评论不改任务本身,看板的轮询带不回来)。 */
const COMMENTS_POLL_MS = 30_000;

export default function TaskComments({ cfg, requirementId, people, onLoadPeople }: { cfg: HubConfig; requirementId: string; people: readonly RequirementPerson[]; onLoadPeople?: () => unknown }) {
  useTranslation();
  const [comments, setComments] = useState<CardComment[]>([]);
  const [all, setAll] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 鼠标设备上没有「长按」:评论正文的复制入口改成时间戳旁的「复制」按钮(phone-only-ui 的判定见 pointer-ui)。
  const pointer = pointerUi();
  // 评论正文按 Markdown 渲染后不再是 Selectable Text,长按复制原文补回复制能力(通信欧 #1831)。
  const copyComment = useCallback(async (id: string, text: string) => {
    try {
      await Clipboard.setStringAsync(text);
    } catch {
      try { await (globalThis as any).navigator?.clipboard?.writeText?.(text); } catch { return; }
    }
    setCopiedId(id);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedId(null), 1500);
  }, []);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  const load = useCallback(async () => {
    try {
      setComments(cardComments(parseEvents(await fetchRequirementEvents(cfg, { requirementId, limit: 200 })).events));
    } catch { /* 旧 Hub / 读不到:不画 */ }
  }, [cfg, requirementId]);
  usePoll(load, COMMENTS_POLL_MS, [load]);
  // 看板只在有卡带负责人时才读成员;没人负责的卡上,评论者会显示成「未知成员」。缺谁就补读一次(每次打开最多一次)。
  const askedPeople = useRef(false);
  const missing = comments.some(c => c.actor && !people.some(p => p.kind === c.actor!.kind && p.id === c.actor!.id));
  useEffect(() => {
    if (!missing || askedPeople.current || !onLoadPeople) return;
    askedPeople.current = true;
    void onLoadPeople();
  }, [missing, onLoadPeople]);
  if (!comments.length) return null;
  const hidden = all ? 0 : Math.max(0, comments.length - COMMENTS_SHOWN);
  return (
    <View style={{ gap: spacing.sm }} testID="req-comments">
      <Text style={{ color: colors.textSecondary, fontSize: typeScale.small, fontWeight: weight.medium }}>{tr('comments.title')}</Text>
      {hidden ? (
        <Pressable accessibilityRole="button" onPress={() => setAll(true)} hitSlop={6} testID="req-comments-earlier">
          <Text style={{ color: colors.accent, fontSize: typeScale.small }}>{tr('comments.earlier', { n: hidden })}</Text>
        </Pressable>
      ) : null}
      {comments.slice(hidden).map(c => {
        const who = c.actor ? personDisplay(c.actor, people).name : tr('act.unknown');
        return (
          <View key={c.id} style={{ gap: 2, paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.border }} testID={`req-comment-${c.id}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <Text style={{ color: colors.textSecondary, fontSize: typeScale.small, flexShrink: 1 }} numberOfLines={1}>
                {who}{c.actor?.kind === 'node' ? ` · ${tr('act.agent')}` : ''} · {c.at}
              </Text>
              {pointer ? (
                <Pressable accessibilityRole="button" hitSlop={6} onPress={() => { void copyComment(c.id, c.text); }} testID={`req-comment-copy-${c.id}`}>
                  <Text style={{ color: colors.accent, fontSize: typeScale.small }}>{tr('comments.copy')}</Text>
                </Pressable>
              ) : null}
            </View>
            <Pressable
              onLongPress={pointer ? undefined : () => { void copyComment(c.id, c.text); }}
              delayLongPress={400}
              accessibilityRole="text"
              accessibilityHint={pointer ? undefined : tr('comments.copyHint')}
              testID={`req-comment-text-${c.id}`}
            >
              <MarkdownMessage>{c.text}</MarkdownMessage>
            </Pressable>
            {copiedId === c.id ? (
              <Text style={{ color: colors.textSecondary, fontSize: typeScale.small }} testID={`req-comment-copied-${c.id}`}>{tr('comments.copied')}</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
