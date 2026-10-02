import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ackUserMessages, type HubConfig } from './api';
import { noticeAckIds } from './system-notice';
import {
  consumeDesktopMessageEvent,
  type DesktopMessageNotice as Notice,
} from './desktop-message-consume';
import DesktopMessageNotice from './DesktopMessageNotice';
import { canOpenUserEventStream, openUserEventStream } from './user-events-sse';
import { requestNotifierRefresh } from './notifier-bus';
import { isHumanDmNotice, parseMemberPresence } from './human-dm';
import { activeDmPeer, emitHumanDm, emitMemberPresence } from './human-dm-bus';
import { parseGroupEvent } from './group-chat';
import { emitGroupChat } from './group-chat-bus';

const SEEN_CAP = 200;

/**
 * App-wide consumer for Hub `type=desktop_message` SSE events.
 * Mounted only while a user session exists. Does not touch unread/badge.
 */
export default function DesktopMessageListener({ cfg, onOpenTask }: { cfg: HubConfig; onOpenTask?: (requirementId: string) => void }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const seen = useRef<Set<string>>(new Set());

  const ackNotice = (n: Notice, event: 'shown' | 'opened') => {
    const ids = noticeAckIds(n, event);
    if (ids.length) void ackUserMessages(cfg, ids).catch(() => {});
  };

  useEffect(() => {
    if (!canOpenUserEventStream(cfg)) return;
    const ctx = { networkId: cfg.networkId };
    const close = openUserEventStream(cfg, {
      onEvent: (raw) => {
        const presence = parseMemberPresence(raw);
        if (presence) { emitMemberPresence(presence); return; }
        // 群聊(RFC-042,Hub ≥ .93):group_message / group_read 不是 desktop_message,不弹顶部提示,
        // 只让会话列表改未读、开着的群聊拉新的。旧 Hub 不推这两种事件。
        const groupEvent = parseGroupEvent(raw);
        if (groupEvent) { emitGroupChat(groupEvent); return; }
        const result = consumeDesktopMessageEvent(raw, ctx);
        if (result.status !== 'present') return;
        if (seen.current.has(result.notice.messageId)) return;
        seen.current.add(result.notice.messageId);
        // 手机端:agent 的 desktop_message 已经落进 user_inbox —— 让通知那边立刻拉一次,不等下一拍轮询。
        requestNotifierRefresh();
        if (seen.current.size > SEEN_CAP) {
          const first = seen.current.values().next().value;
          if (first) seen.current.delete(first);
        }
        // 人与人私信:人员列表 / 开着的会话去拉新的;正在和这个人聊时不再弹顶部提示。
        if (isHumanDmNotice(result.notice)) {
          emitHumanDm(result.notice.from ?? null);
          if (result.notice.from && result.notice.from === activeDmPeer()) return;
        }
        // 「任务提醒」的到期提醒没有会话可去:弹出即在 Hub 上标已读(system-notice.ts),不留清不掉的未读。
        ackNotice(result.notice, 'shown');
        setNotice(result.notice);
      },
    });
    return close;
  }, [cfg.serverUrl, cfg.token, cfg.networkId]);

  if (!notice) return null;
  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <DesktopMessageNotice notice={notice} onDismiss={() => setNotice(null)} onOpenTask={onOpenTask ? id => { ackNotice(notice, 'opened'); onOpenTask(id); } : undefined} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 48,
    left: 12,
    right: 12,
    zIndex: 40,
    elevation: 40,
    alignItems: 'center',
  },
});
