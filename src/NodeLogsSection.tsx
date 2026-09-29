// 节点页「运行日志」(只读)—— 节点自己的 agent-node 运行日志末尾。
//
// 数据流与规则文件 / 项目文件夹同一条门铃:tailNodeLogs → hub 落 node_rules_requests(op=logs_tail)
// + 门铃 → 节点读**自己的**日志目录、逐行脱敏、按级别 / 关键词过滤 → waitForRulesFileResult 轮询到终态。
// 🔴 请求里没有路径;脱敏在节点上做完。hub 把结果只交给发请求的这个登录一次、读完即删,
//    所以「实时跟随」每 3 秒发一个新请求(带 since_ts),不去跟别人的请求。
// 版本不够(没上报 logs_capable)当场说「节点版本过旧，升级后可查看日志」,不发请求。
//
// 平台(Owner 2026-09-27「Windows / Mac 跟安卓版肯定是不一样的」):
//   桌面(pointer)—— 鼠标键盘:日志文字可拖选,Ctrl/⌘+F 聚焦搜索框,悬停高亮,导出 = 另存为 .log;
//   手机 —— 手指:筛选标签 ≥ 36 高,没有悬停才出现的东西,导出 = 系统分享。

import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';

import { tailNodeLogs, waitForRulesFileResult, type HubConfig, type RulesTarget, type Session } from './api';
import { chooseSavePath, displayDownloadPath, isTauriDesktop, saveToDownloads } from './desktop-download';
import InfoTip from './InfoTip';
import {
  LOG_LEVEL_CHIPS, LOGS_FOLLOW_MS, LOGS_SEARCH_DEBOUNCE_MS, lineTone, logsEmptyMessage, logsEnqueueError, logsExportName, logsQuery,
  logsStatusMessage, logsSupport, logsTarget, logsText, mergeFollow, nextSinceTs, parseLogsTail,
  type LogLevelFilter, type LogLine, type LogsTail,
} from './node-logs';
import { isTerminal, nextPollDelayMs } from './node-rules';
import { isFindShortcut } from './rules-find';
import { isMacKeyboard } from './shortcuts-store';
import { colors, radius, spacing, type } from './theme';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const WEB = Platform.OS === 'web';
const INFO = '这个节点 agent-node 进程自己写的运行日志(只读,最新的在最下面)。令牌、Bearer / Authorization、带 TOKEN / KEY / SECRET / PASSWORD 的配置值在节点上就被遮住了,不会离开节点。';

export type NodeLogsSectionProps = {
  cfg: HubConfig; alias?: string; node?: RulesTarget | null; session: Session;
  /** 鼠标 + 键盘的界面(pointer-ui.ts pointerUi);false = 手指。 */
  pointer: boolean;
};

export function NodeLogsSection({ cfg, alias, node, session, pointer }: NodeLogsSectionProps) {
  const s = { ...session, alias: session.alias || alias || '' };
  const support = logsSupport(s);
  const target = support.kind === 'capable' ? logsTarget({ node: node ?? null, session: s }) : null;
  if (support.kind !== 'capable' || !target) {
    return (
      <Card testID="node-logs-unsupported">
        <Text style={{ color: colors.failed, fontSize: type.small, lineHeight: 18 }}>{support.kind === 'unsupported' ? support.message : '找不到可以发请求的节点'}</Text>
      </Card>
    );
  }
  return <LogsViewer cfg={cfg} target={target} alias={s.alias} pointer={pointer} />;
}

type Phase = 'loading' | 'ready' | 'error';
type Fetched = { ok: true; tail: LogsTail } | { ok: false; message: string };

/** 页面在不在前台(原生:AppState;web / 桌面:document.visibilityState)。 */
function useForeground(): boolean {
  const [fg, setFg] = useState(true);
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => setFg(st === 'active'));
    const doc = (globalThis as any).document;
    const onVis = () => setFg(doc?.visibilityState !== 'hidden');
    doc?.addEventListener?.('visibilitychange', onVis);
    return () => { sub.remove(); doc?.removeEventListener?.('visibilitychange', onVis); };
  }, []);
  return fg;
}

function LogsViewer({ cfg: cfgProp, target: targetProp, alias, pointer }: { cfg: HubConfig; target: RulesTarget; alias: string; pointer: boolean }) {
  // 节点页每 10 秒轮询一次,父组件每次都给出新的 target / cfg 对象。按内容固定下来 —— 否则 fetchTail 换身份,
  // 整页重读每 10 秒触发一次,跟随关掉了日志照样在刷(measure.mjs「stops when off」量出来的)。
  const targetKey = `${targetProp.node_id ?? ''}|${targetProp.alias}`;
  const cfgKey = `${cfgProp.profileId ?? ''}|${cfgProp.serverUrl}|${cfgProp.token}|${cfgProp.networkId ?? ''}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const target = useMemo(() => targetProp, [targetKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cfg = useMemo(() => cfgProp, [cfgKey]);
  const [level, setLevel] = useState<LogLevelFilter>('all');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [follow, setFollow] = useState(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const [lines, setLines] = useState<LogLine[]>([]);
  const [meta, setMeta] = useState<{ files: number; truncated: boolean; matched: number; nodeNow: number | null }>({ files: 0, truncated: false, matched: 0, nodeNow: null });
  const [notice, setNotice] = useState('');
  const foreground = useForeground();
  const cancelled = useRef(false);
  const seq = useRef(0);
  const busy = useRef(false);
  const linesRef = useRef<LogLine[]>([]);
  linesRef.current = lines;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const searchRef = useRef<any>(null);
  const scrollRef = useRef<any>(null);
  useEffect(() => () => { cancelled.current = true; }, []);

  // 一次请求:发 → 等终态 → 解析。节点上一条还没答完(单飞)就先等它结束再发自己的。
  const fetchTail = useCallback(async (query: ReturnType<typeof logsQuery>): Promise<Fetched | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      let enq = await tailNodeLogs(cfg, target, query);
      if (cancelled.current) return null;
      if (!enq.ok && enq.existing_request_id) {
        await waitForRulesFileResult(cfg, enq.existing_request_id, { nextDelayMs: nextPollDelayMs, isTerminal, isCancelled: () => cancelled.current });
        if (cancelled.current) return null;
        enq = await tailNodeLogs(cfg, target, query);
      }
      if (!enq.ok) return { ok: false, message: enq.unsupported ? enq.error : logsEnqueueError(enq.code ?? enq.error) };
      const res = await waitForRulesFileResult(cfg, enq.request_id, { nextDelayMs: nextPollDelayMs, isTerminal, isCancelled: () => cancelled.current });
      if (cancelled.current) return null;
      if (!res.ok) return { ok: false, message: res.error };
      if (res.status !== 'done') return { ok: false, message: logsStatusMessage(res.status, res.error) };
      // 读后即删:同一个结果被读过(比如重复挂载)就再要一次,不给人看「内容已过期」。
      if (res.content_purged || typeof res.content !== 'string') continue;
      const tail = parseLogsTail(res.content);
      return tail ? { ok: true, tail } : { ok: false, message: '节点返回的日志无法解析' };
    }
    return { ok: false, message: '日志内容已被读取过，请点「刷新」' };
  }, [cfg, target]);

  // 整页重读:进来时、换级别 / 搜索词、点刷新。旧请求的结果晚到就丢掉(seq)。
  const reload = useCallback(async () => {
    const my = ++seq.current;
    busy.current = true;
    setPhase('loading'); setMessage('');
    const r = await fetchTail(logsQuery({ level, search: applied }));
    if (my !== seq.current) return; // 更新的一次重读接管了 busy
    busy.current = false;
    if (!r) return;
    if (!r.ok) { setPhase('error'); setMessage(r.message); return; }
    setLines(r.tail.lines);
    setMeta({ files: r.tail.files.length, truncated: r.tail.truncated, matched: r.tail.matched, nodeNow: r.tail.now_ts });
    setPhase('ready');
  }, [fetchTail, level, applied]);
  useEffect(() => { void reload(); }, [reload]);

  // 搜索框停手 400ms 再发(每个字母一个节点请求太吵)。
  useEffect(() => {
    if (search === applied) return;
    const t = setTimeout(() => setApplied(search), LOGS_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search, applied]);

  // 实时跟随:打开、页面在前台、首轮已读完时,每 3 秒要一次 since_ts 之后的行;关掉 / 切走 / 卸载就停。
  useEffect(() => {
    if (!follow || !foreground || phase !== 'ready') return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (stop || cancelled.current) return;
      if (!busy.current) {
        busy.current = true;
        const my = seq.current;
        const since = nextSinceTs(linesRef.current, metaRef.current.nodeNow);
        const r = await fetchTail(logsQuery({ level, search: applied, sinceTs: since }));
        busy.current = false;
        if (stop || my !== seq.current || !r) return;
        if (r.ok) {
          setLines(prev => mergeFollow(prev, r.tail.lines));
          setMeta(m => ({ ...m, files: r.tail.files.length, nodeNow: r.tail.now_ts ?? m.nodeNow }));
          setMessage('');
        } else setMessage(r.message);
      }
      if (!stop) timer = setTimeout(tick, LOGS_FOLLOW_MS);
    };
    timer = setTimeout(tick, LOGS_FOLLOW_MS);
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [follow, foreground, phase, fetchTail, level, applied]);

  // 停在最下面(最新的一行):读完 / 新行进来时,只要人没往上翻就贴底;往上翻了就不打扰(跟随时除外)。
  const pinBottom = useRef(true);
  useEffect(() => { if (phase === 'loading') pinBottom.current = true; }, [phase]);
  const onContentSize = () => { if (pinBottom.current || follow) scrollRef.current?.scrollToEnd?.({ animated: false }); };
  const onScroll = (e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    pinBottom.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 40;
  };

  // 桌面:Ctrl/⌘+F 聚焦搜索框(只在这个分区挂着时监听)。手机没有键盘快捷键。
  useEffect(() => {
    if (!pointer || !WEB) return;
    const doc = (globalThis as any).document;
    if (!doc?.addEventListener) return;
    const mac = isMacKeyboard();
    const onKey = (e: any) => {
      if (!isFindShortcut(e, mac)) return;
      e.preventDefault?.();
      searchRef.current?.focus?.();
      searchRef.current?.select?.();
    };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [pointer]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  const copy = async () => {
    const text = logsText(lines);
    if (!text) return;
    try { await Clipboard.setStringAsync(text); }
    catch {
      try { await (globalThis as any).navigator?.clipboard?.writeText?.(text); } catch { setNotice('复制失败'); return; }
    }
    setNotice(`已复制 ${lines.length} 行`);
  };

  const exportLog = async () => {
    const text = logsText(lines);
    if (!text) return;
    const name = logsExportName(alias);
    try {
      if (isTauriDesktop()) {
        const path = await chooseSavePath(name);
        if (!path) return;
        const saved = await saveToDownloads(name, new TextEncoder().encode(text), path);
        setNotice(`已导出到 ${displayDownloadPath(saved)}`);
      } else if (WEB) {
        const doc = (globalThis as any).document;
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = doc.createElement('a');
        a.href = url; a.download = name;
        doc.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice(`已下载 ${name}`);
      } else {
        const uri = `${FileSystem.cacheDirectory}${name}`;
        await FileSystem.writeAsStringAsync(uri, text);
        await Sharing.shareAsync(uri, { mimeType: 'text/plain', dialogTitle: name, UTI: 'public.plain-text' });
      }
    } catch (e) {
      setNotice(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const chipH = pointer ? 28 : 36;
  const chips = (
    <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }} accessibilityRole="radiogroup" testID="node-logs-levels">
      {LOG_LEVEL_CHIPS.map(c => {
        const on = c.key === level;
        return (
          <Pressable key={c.key} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`只看${c.label}`}
            onPress={() => { if (!on) setLevel(c.key); }} testID={`node-logs-level-${c.key}`}
            style={(st: any) => [{ height: chipH, minWidth: pointer ? 0 : 48, paddingHorizontal: pointer ? spacing.sm : spacing.md, borderRadius: radius.pill, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: on ? colors.accent : colors.border, backgroundColor: on ? colors.railActiveBg : 'transparent' },
              pointer && st.hovered && !on ? { backgroundColor: colors.rowHover } : null,
              st.pressed ? { opacity: 0.75 } : null,
              st.focused ? ({ outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.accent, outlineOffset: 1 } as any) : null]}>
            <Text style={{ color: on ? colors.accent : colors.textSecondary, fontSize: type.small, lineHeight: 16 }}>{c.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  const searchBox = (
    <View testID="node-logs-searchbox" style={{ flexDirection: 'row', alignItems: 'center', height: chipH, flexGrow: 1, flexShrink: 1, minWidth: pointer ? 100 : 120, flexBasis: 100, /* 换行按 100 算,不按输入框的默认宽度算 */ paddingHorizontal: spacing.sm, gap: 6, borderRadius: radius.item, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.inputBg }}>
      <Ionicons name="search-outline" size={14} color={colors.textMuted} />
      <TextInput ref={searchRef} value={search} onChangeText={setSearch} testID="node-logs-search"
        placeholder={pointer ? `搜索（${isMacKeyboard() ? '⌘F' : 'Ctrl+F'}）` : '搜索日志'} placeholderTextColor={colors.textMuted}
        autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => setApplied(search)}
        accessibilityLabel="搜索日志"
        style={[{ flex: 1, minWidth: 0, color: colors.text, fontSize: type.small, paddingVertical: 0, height: chipH - 2 }, WEB ? ({ outlineStyle: 'none' } as any) : null]} />
      {search ? (
        <Pressable onPress={() => { setSearch(''); setApplied(''); }} accessibilityRole="button" accessibilityLabel="清除搜索" hitSlop={8}>
          <Ionicons name="close-circle" size={14} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );

  const followBtn = <ToggleBtn label="实时跟随" on={follow} onPress={() => setFollow(f => !f)} height={chipH} pointer={pointer} testID="node-logs-follow" />;
  // 手机:ⓘ 本身 22px,四周再扩 8px 触控区(≈ 38px),不靠悬停。
  const info = <InfoTip label="关于运行日志" text={INFO} hitSlop={pointer ? undefined : 8} />;
  const exportLabel = WEB ? '导出' : '分享';

  const toolbar = pointer ? (
    // 桌面:一行,左筛选、中搜索、右动作(文字按钮);窄了就换行(flexWrap),每行各自居中对齐。
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, zIndex: 10 }} testID="node-logs-toolbar">
      {chips}{searchBox}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        {followBtn}
        <SmallBtn label="复制" onPress={copy} disabled={!lines.length} height={chipH} pointer testID="node-logs-copy" />
        <SmallBtn label={exportLabel} onPress={exportLog} disabled={!lines.length} height={chipH} pointer testID="node-logs-export" />
        <SmallBtn label="刷新" onPress={() => void reload()} height={chipH} pointer testID="node-logs-refresh" />
        {info}
      </View>
    </View>
  ) : (
    // 手机:两行 —— 筛选 + 跟随 + ⓘ(横向可滑),搜索 + 图标按钮(36×36,够手指点;没有悬停)。
    <View style={{ gap: spacing.sm, zIndex: 10 }} testID="node-logs-toolbar">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', gap: spacing.sm }}>{chips}{followBtn}{info}</ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        {searchBox}
        <IconBtn icon="copy-outline" label="复制" onPress={copy} disabled={!lines.length} size={chipH} testID="node-logs-copy" />
        <IconBtn icon={WEB ? 'download-outline' : 'share-outline'} label={exportLabel} onPress={exportLog} disabled={!lines.length} size={chipH} testID="node-logs-export" />
        <IconBtn icon="refresh-outline" label="刷新" onPress={() => void reload()} size={chipH} testID="node-logs-refresh" />
      </View>
    </View>
  );

  const status = (() => {
    if (phase === 'loading' && !lines.length) return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md }} testID="node-logs-loading">
        <ActivityIndicator color={colors.textMuted} />
        <Text style={{ color: colors.textMuted, fontSize: type.small }}>正在读取节点日志…</Text>
      </View>
    );
    if (phase === 'error') return (
      <View style={{ gap: spacing.sm, padding: spacing.md, alignItems: 'flex-start' }} testID="node-logs-error">
        <Text style={{ color: colors.failed, fontSize: type.small, lineHeight: 18 }}>{message}</Text>
        <SmallBtn label="重试" onPress={() => void reload()} height={chipH} pointer={pointer} />
      </View>
    );
    if (phase === 'ready' && !lines.length) return (
      <View style={{ padding: spacing.md }} testID="node-logs-empty">
        <Text style={{ color: colors.textMuted, fontSize: type.small }}>{logsEmptyMessage({ files: meta.files, level, search: applied })}</Text>
      </View>
    );
    return null;
  })();

  return (
    <View style={{ flex: 1, minHeight: 0, gap: spacing.sm }}>
      {toolbar}
      <View style={{ flex: 1, minHeight: 160, backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden' }} testID="node-logs-viewer">
        {status ?? (
          <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.md }} onContentSizeChange={onContentSize} onScroll={onScroll} scrollEventThrottle={100} testID="node-logs-scroll">
            {/* 一整块可选文本:桌面拖选跨行、复制保留换行;每行按级别上色(错误红、警告琥珀)。 */}
            <Text selectable={pointer || WEB} testID="node-logs-text" style={{ fontFamily: MONO, fontSize: 12, lineHeight: 18, color: colors.text }}>
              {lines.map((l, i) => {
                const tone = lineTone(l.level);
                return (
                  <Text key={l.key} style={tone === 'error' ? { color: colors.failed } : tone === 'warn' ? { color: colors.blocked } : undefined}>
                    {l.text}{i < lines.length - 1 ? '\n' : ''}
                  </Text>
                );
              })}
            </Text>
          </ScrollView>
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 18 }}>
        <Text style={{ color: colors.textMuted, fontSize: type.caption }} testID="node-logs-footer">
          {lines.length ? `${lines.length} 行${meta.matched > lines.length ? ` · 只显示最新的 ${lines.length} 行(共 ${meta.matched} 行匹配)` : ''}` : ''}
          {follow ? `${lines.length ? ' · ' : ''}实时跟随中，每 ${LOGS_FOLLOW_MS / 1000} 秒刷新` : ''}
        </Text>
        {phase === 'loading' && lines.length ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
        {message && phase === 'ready' ? <Text style={{ color: colors.failed, fontSize: type.caption }}>{message}</Text> : null}
        <View style={{ flex: 1 }} />
        {notice ? <Text style={{ color: colors.running, fontSize: type.caption }} testID="node-logs-notice">{notice}</Text> : null}
      </View>
    </View>
  );
}

function Card({ children, testID }: { children: ReactNode; testID?: string }) {
  return <View testID={testID} style={{ backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm }}>{children}</View>;
}

function SmallBtn({ label, onPress, disabled, height, pointer, testID }: { label: string; onPress: () => void; disabled?: boolean; height: number; pointer: boolean; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} testID={testID}
      style={(st: any) => [{ height, justifyContent: 'center', paddingHorizontal: spacing.sm + 2, borderRadius: radius.item, borderWidth: 1, borderColor: colors.border, opacity: disabled ? 0.4 : 1 },
        pointer && st.hovered ? { backgroundColor: colors.rowHover } : null,
        st.pressed ? { opacity: 0.75 } : null,
        st.focused ? ({ outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.accent, outlineOffset: 1 } as any) : null]}>
      <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 16 }}>{label}</Text>
    </Pressable>
  );
}

function IconBtn({ icon, label, onPress, disabled, size, testID }: { icon: string; label: string; onPress: () => void; disabled?: boolean; size: number; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} testID={testID}
      style={(st: any) => [{ width: size, height: size, alignItems: 'center', justifyContent: 'center', borderRadius: radius.item, borderWidth: 1, borderColor: colors.border, opacity: disabled ? 0.4 : 1 },
        st.pressed ? { backgroundColor: colors.rowActive } : null]}>
      <Ionicons name={icon as any} size={16} color={colors.textSecondary} />
    </Pressable>
  );
}

function ToggleBtn({ label, on, onPress, height, pointer, testID }: { label: string; on: boolean; onPress: () => void; height: number; pointer: boolean; testID?: string }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={onPress} testID={testID}
      style={(st: any) => [{ height, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm + 2, borderRadius: radius.item, borderWidth: 1, borderColor: on ? colors.accent : colors.border, backgroundColor: on ? colors.railActiveBg : 'transparent' },
        pointer && st.hovered && !on ? { backgroundColor: colors.rowHover } : null,
        st.pressed ? { opacity: 0.75 } : null,
        st.focused ? ({ outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.accent, outlineOffset: 1 } as any) : null]}>
      {/* 手机上多一个状态点(没有悬停,开 / 关要一眼看出);桌面靠描边和底色,省下宽度让工具条一行放下。 */}
      {!pointer ? <View style={{ width: 7, height: 7, borderRadius: radius.pill, backgroundColor: on ? colors.running : colors.textMuted }} /> : null}
      <Text style={{ color: on ? colors.accent : colors.textSecondary, fontSize: 12, lineHeight: 16 }}>{label}</Text>
    </Pressable>
  );
}

export default NodeLogsSection;
