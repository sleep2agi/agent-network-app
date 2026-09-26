import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { HubConfig } from './api';
import {
  consumeDesktopMessageEvent,
  type DesktopMessageNotice as Notice,
} from './desktop-message-consume';
import DesktopMessageNotice from './DesktopMessageNotice';
import { canOpenUserEventStream, openUserEventStream } from './user-events-sse';
import { requestNotifierRefresh } from './notifier-bus';

const SEEN_CAP = 200;

/**
 * App-wide consumer for Hub `type=desktop_message` SSE events.
 * Mounted only while a user session exists. Does not touch unread/badge.
 */
export default function DesktopMessageListener({ cfg }: { cfg: HubConfig }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!canOpenUserEventStream(cfg)) return;
    const ctx = { networkId: cfg.networkId };
    const close = openUserEventStream(cfg, {
      onEvent: (raw) => {
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
        setNotice(result.notice);
      },
    });
    return close;
  }, [cfg.serverUrl, cfg.token, cfg.networkId]);

  if (!notice) return null;
  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <DesktopMessageNotice notice={notice} onDismiss={() => setNotice(null)} />
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
