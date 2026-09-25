// 设置里看节点的「项目文件夹」(只读)—— 节点工作目录的文件树,点目录进入、点文件查看。
//
// 数据流与节点规则 / 技能同一条门铃:listNodeFiles / readNodeFile → hub 落
// node_rules_requests(op=files_list / file_read)+ 门铃 → 节点在自己的工作目录里列 / 读
// → waitForRulesFileResult 轮询到终态。
// 🔴 只传相对工作目录的路径(由节点回来的名字拼出来);拒绝 ..、realpath 收口、凭据文件不回内容
//    都在 hub 和节点两侧。凭据文件这里连请求都不发,直接说「凭据文件，不显示内容」。
// 版本不够(没上报 files_capable)当场说要升级什么,不转 60 秒圈(同 app#347)。

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { listNodeFiles, readNodeFile, waitForRulesFileResult, type HubConfig, type RulesFileEnqueueResult, type RulesTarget, type Session } from './api';
import InfoTip from './InfoTip';
import MarkdownMessage from './MarkdownMessage';
import {
  entryAction, entryIcon, fileNotice, filesStatusMessage, filesSupport, filesTarget, filesUnsupportedMessage, formatSize,
  lineNumberGutter, parentPath, parseFileContent, parseFilesListing, pathCrumbs, relativeTime, SECRET_FILE_MESSAGE, viewerModeFor,
  type NodeFileContent, type NodeFileEntry, type NodeFilesListing,
} from './node-files';
import { isTerminal, nextPollDelayMs, requestIdToFollow, resultProblem } from './node-rules';
import { colors, radius, spacing, type } from './theme';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const WEB = Platform.OS === 'web';
const INFO = '节点工作目录里的文件(只读)。路径以工作目录为根,不能跳出去;指向外面的链接不跟随。.env、密钥、auth.json 等凭据文件只显示名字,不显示内容;node_modules 和 .git 不展开。';

export type NodeFilesSectionProps = { cfg: HubConfig; alias?: string; node?: RulesTarget | null; session: Session };

export function NodeFilesSection({ cfg, alias, node, session }: NodeFilesSectionProps) {
  const s = { ...session, alias: session.alias || alias || '' };
  const support = filesSupport(s);
  const target = support.kind === 'capable' ? filesTarget({ node: node ?? null, session: s }) : null;
  if (support.kind !== 'capable' || !target) {
    const msg = support.kind === 'unsupported' ? filesUnsupportedMessage(support) : '找不到可以发请求的节点';
    return (
      <Card testID="node-files-unsupported">
        <Toolbar crumbs={<Text style={{ color: colors.textSecondary, fontSize: 13 }}>项目</Text>} />
        <Text style={{ color: colors.failed, fontSize: type.small, lineHeight: 18 }}>{msg}</Text>
      </Card>
    );
  }
  return <FilesBrowser cfg={cfg} target={target} />;
}

type Phase = 'loading' | 'ready' | 'error';
type Open = { path: string; name: string } | null;

function FilesBrowser({ cfg, target }: { cfg: HubConfig; target: RulesTarget }) {
  const [dir, setDir] = useState('');
  const [listing, setListing] = useState<NodeFilesListing | null>(null);
  const [listPhase, setListPhase] = useState<Phase>('loading');
  const [listMsg, setListMsg] = useState('');
  const [open, setOpen] = useState<Open>(null);
  const [file, setFile] = useState<NodeFileContent | null>(null);
  const [filePhase, setFilePhase] = useState<Phase>('ready');
  const [fileMsg, setFileMsg] = useState('');
  const [note, setNote] = useState('');
  const cancelled = useRef(false);
  const seq = useRef(0);
  useEffect(() => () => { cancelled.current = true; }, []);
  const key = `${target.node_id ?? ''}|${target.alias}`;

  // 同一节点的列 / 读共用一条单飞通道:上一条还在跑就先等它,再发一次(不把「等一下」说成失败)。
  const ask = useCallback(async (enqueue: () => Promise<RulesFileEnqueueResult>) => {
    let enq = await enqueue();
    if (!enq.ok && enq.existing_request_id) {
      await waitForRulesFileResult(cfg, enq.existing_request_id, { nextDelayMs: nextPollDelayMs, isTerminal, isCancelled: () => cancelled.current });
      if (cancelled.current) return null;
      enq = await enqueue();
    }
    const follow = requestIdToFollow(enq);
    if (!follow) return { ok: false as const, error: enq.ok ? 'Hub 返回空响应' : enq.error };
    return waitForRulesFileResult(cfg, follow, { nextDelayMs: nextPollDelayMs, isTerminal, isCancelled: () => cancelled.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, key]);

  const loadDir = useCallback(async (path: string) => {
    const my = ++seq.current;
    setDir(path); setOpen(null); setFile(null); setNote('');
    setListPhase('loading'); setListMsg(filesStatusMessage('pending', null));
    const res = await ask(() => listNodeFiles(cfg, target, path));
    if (cancelled.current || my !== seq.current || !res) return;
    const problem = resultProblem(res);
    if (problem !== null) { setListPhase('error'); setListMsg(problem); return; }
    if (!res.ok) return;
    if (res.status !== 'done') { setListPhase('error'); setListMsg(filesStatusMessage(res.status, res.error)); return; }
    const l = parseFilesListing(res.content);
    if (!l) { setListPhase('error'); setListMsg('节点返回的目录内容无法解析'); return; }
    setListing(l); setListPhase('ready'); setListMsg('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, key]);

  const openFile = useCallback(async (path: string, name: string, secret: boolean) => {
    const my = ++seq.current;
    setOpen({ path, name }); setNote('');
    if (secret) { setFile({ path, name, kind: 'secret' }); setFilePhase('ready'); setFileMsg(''); return; }
    setFile(null); setFilePhase('loading'); setFileMsg(filesStatusMessage('pending', null));
    const res = await ask(() => readNodeFile(cfg, target, path));
    if (cancelled.current || my !== seq.current || !res) return;
    const problem = resultProblem(res);
    if (problem !== null) { setFilePhase('error'); setFileMsg(problem); return; }
    if (!res.ok) return;
    if (res.status !== 'done') { setFilePhase('error'); setFileMsg(filesStatusMessage(res.status, res.error)); return; }
    const f = parseFileContent(res.content);
    if (!f) { setFilePhase('error'); setFileMsg('节点返回的文件内容无法解析'); return; }
    setFile(f); setFilePhase('ready'); setFileMsg('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, key]);

  useEffect(() => { void loadDir(''); }, [loadDir]);

  const onEntry = (e: NodeFileEntry) => {
    const a = entryAction(dir, e);
    if (a.kind === 'descend') void loadDir(a.path);
    else if (a.kind === 'open') void openFile(a.path, e.name, false);
    else if (a.kind === 'secret') void openFile(a.path, e.name, true);
    else setNote(`${e.name}:${a.reason}`);
  };

  const busy = listPhase === 'loading' || filePhase === 'loading';
  const crumbs = pathCrumbs(dir);
  const crumbRow = (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', flexShrink: 1, minWidth: 0 }} testID="node-files-breadcrumb">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1 && !open;
        return (
          <View key={c.path || '/'} style={{ flexDirection: 'row', alignItems: 'center' }}>
            {i > 0 ? <Text style={{ color: colors.textMuted, fontSize: 13, marginHorizontal: 4 }}>/</Text> : null}
            <Pressable accessibilityRole="link" disabled={last} onPress={() => void loadDir(c.path)}
              style={(st: any) => [{ borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1 }, st.hovered && !last ? { backgroundColor: colors.rowHover } : null]}>
              <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: i === 0 ? undefined : MONO, color: last ? colors.text : colors.accent, fontWeight: last ? '600' : '400' }}>{c.label}</Text>
            </Pressable>
          </View>
        );
      })}
      {open ? (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: colors.textMuted, fontSize: 13, marginHorizontal: 4 }}>/</Text>
          <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: MONO, color: colors.text, fontWeight: '600' }}>{open.name}</Text>
        </View>
      ) : null}
    </View>
  );
  const countText = !open && listPhase === 'ready' && listing ? `${listing.total} 项` : '';

  return (
    <Card testID="node-files">
      <Toolbar
        crumbs={crumbRow}
        right={(
          <>
            {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
            {countText ? <Text style={{ color: colors.textMuted, fontSize: 12 }}>{countText}</Text> : null}
            <InfoTip label="项目文件夹说明" text={INFO} />
            <SmallBtn label="刷新" disabled={busy} onPress={() => (open ? void openFile(open.path, open.name, file?.kind === 'secret') : void loadDir(dir))} />
          </>
        )}
      />
      {note ? <Text style={{ color: colors.textMuted, fontSize: 12 }}>{note}</Text> : null}
      {open ? (
        <FileViewer file={file} phase={filePhase} message={fileMsg} name={open.name} onBack={() => { setOpen(null); setFile(null); seq.current++; }} />
      ) : listPhase === 'loading' && !listing ? (
        <Text style={{ color: colors.textMuted, fontSize: type.small }}>{listMsg}</Text>
      ) : listPhase === 'error' ? (
        <Text style={{ color: colors.failed, fontSize: type.small, lineHeight: 18 }}>{listMsg}</Text>
      ) : listing ? (
        <DirList listing={listing} dir={dir} dim={listPhase === 'loading'} onEntry={onEntry} onUp={() => void loadDir(parentPath(dir))} />
      ) : null}
    </Card>
  );
}

function DirList({ listing, dir, dim, onEntry, onUp }: { listing: NodeFilesListing; dir: string; dim: boolean; onEntry: (e: NodeFileEntry) => void; onUp: () => void }) {
  const now = Date.now();
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, opacity: dim ? 0.5 : 1 }} testID="node-files-list">
      {dir ? (
        <Row onPress={onUp} icon="arrow-up-outline" iconColor={colors.textMuted} name=".." label="上一级" />
      ) : null}
      {listing.entries.length === 0 ? (
        <Text style={{ color: colors.textMuted, fontSize: type.small, paddingVertical: spacing.md, paddingHorizontal: spacing.sm }}>空目录</Text>
      ) : listing.entries.map(e => {
        const a = entryAction(dir, e);
        const tag = e.hidden_reason === 'secret' ? '凭据' : e.hidden_reason === 'skipped' ? '不展开' : e.type === 'symlink' && e.link_type === null ? '外部链接' : e.type === 'symlink' ? '链接' : '';
        const isDir = e.type === 'dir' || (e.type === 'symlink' && e.link_type === 'dir');
        return (
          <Row key={e.name} onPress={() => onEntry(e)} icon={entryIcon(e)} iconColor={isDir && a.kind === 'descend' ? colors.accent : colors.textMuted}
            name={e.name} tag={tag} muted={a.kind === 'none'}
            size={e.type === 'file' && !e.hidden_reason ? formatSize(e.size) : ''} time={relativeTime(e.mtime, now)} chevron={a.kind === 'descend'} />
        );
      })}
      {listing.truncated ? (
        <Text style={{ color: colors.textMuted, fontSize: 12, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm }}>只显示前 {listing.entries.length} 项(共 {listing.total} 项)</Text>
      ) : null}
    </View>
  );
}

function Row({ onPress, icon, iconColor, name, label, tag, size, time, muted, chevron }: {
  onPress: () => void; icon: string; iconColor: string; name: string; label?: string; tag?: string; size?: string; time?: string; muted?: boolean; chevron?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label ?? name} onPress={onPress}
      style={(st: any) => [{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 34, paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
        st.hovered || st.pressed ? { backgroundColor: colors.rowHover } : null,
        st.focused ? ({ outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.accent, outlineOffset: -2 } as any) : null]}>
      <Ionicons name={icon as any} size={16} color={iconColor} />
      <Text numberOfLines={1} style={{ flexShrink: 1, color: muted ? colors.textMuted : colors.text, fontSize: 13, fontFamily: MONO }}>{name}</Text>
      {label ? <Text style={{ color: colors.textMuted, fontSize: 12 }}>{label}</Text> : null}
      {tag ? (
        <View style={{ backgroundColor: colors.subtleFill, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{tag}</Text>
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      {size ? <Text style={{ color: colors.textMuted, fontSize: 12, minWidth: 64, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{size}</Text> : null}
      {time !== undefined ? <Text style={{ color: colors.textMuted, fontSize: 12, minWidth: 76, textAlign: 'right' }}>{time}</Text> : null}
      <View style={{ width: 14 }}>{chevron ? <Ionicons name="chevron-forward" size={13} color={colors.textMuted} /> : null}</View>
    </Pressable>
  );
}

function FileViewer({ file, phase, message, name, onBack }: { file: NodeFileContent | null; phase: Phase; message: string; name: string; onBack: () => void }) {
  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <SmallBtn label="← 返回目录" onPress={onBack} />
      <View style={{ flex: 1 }} />
      {file && file.kind !== 'secret' && typeof file.size === 'number' ? <Text style={{ color: colors.textMuted, fontSize: 12 }}>{formatSize(file.size)}</Text> : null}
      {file?.mtime ? <Text style={{ color: colors.textMuted, fontSize: 12 }}>{relativeTime(file.mtime)}修改</Text> : null}
    </View>
  );
  if (phase !== 'ready' || !file) {
    return (
      <View style={{ gap: spacing.sm }}>
        {header}
        <Text style={{ color: phase === 'error' ? colors.failed : colors.textMuted, fontSize: type.small, lineHeight: 18 }}>{message}</Text>
      </View>
    );
  }
  const notice = fileNotice(file);
  if (file.kind !== 'text' || file.content === undefined || file.content === '') {
    const icon = file.kind === 'secret' ? 'lock-closed-outline' : file.kind === 'binary' ? 'cube-outline' : 'document-outline';
    return (
      <View style={{ gap: spacing.sm }} testID="node-files-notice">
        {header}
        <View style={{ alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl, backgroundColor: colors.inputBg, borderRadius: radius.md }}>
          <Ionicons name={icon as any} size={26} color={colors.textMuted} />
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{file.kind === 'secret' ? SECRET_FILE_MESSAGE : notice}</Text>
        </View>
      </View>
    );
  }
  const mode = viewerModeFor(name);
  return (
    <View style={{ gap: spacing.sm }} testID={`node-files-viewer-${mode}`}>
      {header}
      {mode === 'markdown' ? (
        <View style={{ backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md }}>
          <MarkdownMessage>{file.content}</MarkdownMessage>
        </View>
      ) : mode === 'code' ? (
        <CodeView text={file.content} />
      ) : (
        <View style={{ backgroundColor: colors.inputBg, borderRadius: 8, padding: spacing.md }}>
          <Text selectable style={[{ color: colors.text, fontFamily: MONO, fontSize: 12, lineHeight: 18 }, WEB ? ({ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as any) : null]}>{file.content}</Text>
        </View>
      )}
    </View>
  );
}

// 与聊天代码块同一套样式(inputBg 底、8 圆角、等宽 12/18),左边加行号栏;正文不折行、横向滚动,
// 行号栏和正文逐行对齐。
function CodeView({ text }: { text: string }) {
  const { gutter } = lineNumberGutter(text);
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  const mono = { fontFamily: MONO, fontSize: 12, lineHeight: 18 } as const;
  return (
    <View style={{ flexDirection: 'row', backgroundColor: colors.inputBg, borderRadius: 8, overflow: 'hidden' }} testID="node-files-code">
      <Text style={[mono, { color: colors.textMuted, textAlign: 'right', paddingVertical: spacing.md, paddingLeft: spacing.md, paddingRight: spacing.sm, borderRightWidth: 1, borderRightColor: colors.border, opacity: 0.75 }, WEB ? ({ whiteSpace: 'pre', userSelect: 'none' } as any) : null]}>{gutter}</Text>
      <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: spacing.md, paddingHorizontal: spacing.md }}>
        <Text selectable style={[mono, { color: colors.text }, WEB ? ({ whiteSpace: 'pre' } as any) : null]}>{body}</Text>
      </ScrollView>
    </View>
  );
}

function Card({ children, testID }: { children: ReactNode; testID?: string }) {
  return <View testID={testID} style={{ backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm }}>{children}</View>;
}

// 与规则 / 技能区同一种紧凑工具条(app#355):一行,左面包屑,右计数 + ⓘ + 小按钮。
function Toolbar({ crumbs, right }: { crumbs: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, zIndex: 10, minHeight: 30 }}>
      <Ionicons name="folder-open-outline" size={16} color={colors.textMuted} />
      <View style={{ flex: 1, minWidth: 0 }}>{crumbs}</View>
      {right}
    </View>
  );
}

function SmallBtn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled}
      style={(st: any) => [{ height: 30, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: 6, borderWidth: 1, borderColor: colors.border, opacity: disabled ? 0.4 : 1 },
        st.hovered ? { backgroundColor: colors.rowHover } : null,
        st.focused ? ({ outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.accent, outlineOffset: 1 } as any) : null]}>
      <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

export default NodeFilesSection;
