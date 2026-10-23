// GUI 验收集:聊天页「原会话」那一条到底长什么样。
//
// 为什么需要它:2026-10-23 admin 甩来一张截图说「这也太丑了」,圈的是聊天顶部那块
// 整块卡片 —— 而我在 headless 会话里看不到原生窗口,只能靠 web 目标截同一套组件。
// 之前这类验收全靠人肉看手机,改完只能"声称"好了。这个夹具把 header + 那一条
// 按真实组件渲染出来,配 scripts/web-screenshot.mjs 出一张图,改前改后能对比。
//
// 用法:`?fixture=chat-session-strip&state=idle|running|stale|unsupported|error&theme=light|dark`
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { colors, radius, spacing } from './theme';
import NodeSessionControl from './NodeSessionControl';
import { setThemeMode, themeMode } from './theme';
import type { HubConfig } from './api';

const read = (key: string) => new URLSearchParams(globalThis.location?.search ?? '').get(key);
const STATE = read('state') ?? 'running';
const THEME = read('theme') ?? 'light';

export function readChatSessionStripFixture() {
  if (read('fixture') !== 'chat-session-strip') return null;
  return { theme: THEME === 'dark' ? 'dark' as const : 'light' as const, state: STATE };
}

const cfg: HubConfig = { serverUrl: 'https://fixture.invalid', token: 'fixture', networkId: 'net_fixture' };

/** 一个像样的假 Hub:读状态直接成功,不用真网络,截图里就不会出现错误行。 */
function installFixtureFetch(state: string) {
  const g = globalThis as unknown as { fetch: typeof fetch; __fixtureFetch?: boolean };
  if (g.__fixtureFetch) return;
  g.__fixtureFetch = true;
  const body = () => {
    const base = { ok: true, session_id: 's1', binding_id: 'b1', can_request_background: true, observed_at: Math.floor(Date.now() / 1000) };
    if (state === 'unsupported') return { ...base, supported: false, active: false, can_request_background: false };
    if (state === 'idle') return { ...base, supported: true, active: false, can_request_background: false };
    return { ...base, supported: true, active: true };
  };
  g.fetch = (async (input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    if (url.includes('/api/node-session-control')) {
      if (state === 'error') return new Response(JSON.stringify({ error: 'bridge_unavailable' }), { status: 501, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify(body()), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

export default function ChatSessionStripFixtureScreen() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (themeMode() !== (THEME === 'dark' ? 'dark' : 'light')) setThemeMode(THEME === 'dark' ? 'dark' : 'light');
    installFixtureFetch(STATE);
    setReady(true);
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* 聊天页的 header,与 ChatScreen 同一套 token(名字 · 状态 · ⋯) */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
        borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card }}>
        <View style={{ width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.subtleFill }} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>通信客户端欧</Text>
          <Text numberOfLines={1} style={{ color: colors.running, fontSize: 11 }}>工作中</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="更多" style={{ padding: 6 }}>
          <Text style={{ color: colors.textMuted, fontSize: 18 }}>⋯</Text>
        </Pressable>
      </View>

      {ready ? <NodeSessionControl cfg={cfg} target={{ node_id: 'n1', network_id: 'net_fixture', session_id: 's1' }} /> : null}

      {/* 两条消息,用来证明那一条不再压住内容 */}
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={{ alignSelf: 'flex-start', maxWidth: '78%', backgroundColor: colors.card, borderRadius: radius.bubble ?? radius.surface, paddingHorizontal: 12, paddingVertical: 9 }}>
          <Text style={{ color: colors.text, fontSize: 14, lineHeight: 21 }}>推进各平台 App 上线，核对 iOS、Android、Mac、Windows 的版本、提审、上架、灰度和回滚。</Text>
        </View>
        <View style={{ alignSelf: 'flex-start', maxWidth: '78%', backgroundColor: colors.card, borderRadius: radius.surface, paddingHorizontal: 12, paddingVertical: 9 }}>
          <Text style={{ color: colors.text, fontSize: 14, lineHeight: 21 }}>以及可以在任务列表里取消这条任务。</Text>
        </View>
      </View>
    </View>
  );
}
