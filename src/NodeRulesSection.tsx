// app#225 —— 节点详情页的「节点规则」区块：查看 / 编辑节点工作目录下的
// CLAUDE.md（claude 节点）或 AGENTS.md（其余运行时）。
//
// 数据流：readNodeRulesFile → hub 落请求 + 门铃 → 节点读文件 ack →
// waitForRulesFileResult 轮询到终态。保存同理走 writeNodeRulesFile。
// 🔴 这里不传路径、不传文件名（hub 工具入参里没有这些字段）；显示的文件名
// 先按运行时预测，节点回报后以回报为准。
//
// 三种可见状态分开：读取中 / 就绪（可编辑）/ 不可用（hub 旧、节点离线或
// agent-node 旧、读失败），每种都有一句话说明为什么和怎么办。

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { readNodeRulesFile, waitForRulesFileResult, writeNodeRulesFile, type HubConfig, type HubNode, type Session } from './api';
import { styles } from './app-styles';
import { hasUnsavedChanges, isTerminal, nextPollDelayMs, predictedRulesFileName, rulesStatusMessage } from './node-rules';
import { colors, spacing } from './theme';

type Phase = 'loading' | 'ready' | 'saving' | 'unavailable';

export default function NodeRulesSection({ cfg, node, session }: { cfg: HubConfig; node: HubNode; session: Session }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [fileName, setFileName] = useState<string>(() => predictedRulesFileName(session, node));
  const [onNode, setOnNode] = useState<string | null>(null);
  const [editor, setEditor] = useState('');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'muted' | 'ok' | 'error'>('muted');
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);

  const say = (text: string, tone: 'muted' | 'ok' | 'error' = 'muted') => { setMessage(text); setMessageTone(tone); };

  const runRead = useCallback(async () => {
    setPhase('loading');
    say(`正在向节点读取 ${predictedRulesFileName(session, node)}…`);
    const enq = await readNodeRulesFile(cfg, node);
    if (cancelled.current) return;
    if (!enq.ok) { setPhase('unavailable'); say(enq.error, 'error'); return; }
    const res = await waitForRulesFileResult(cfg, enq.request_id, { nextDelayMs: nextPollDelayMs, isTerminal, isCancelled: () => cancelled.current });
    if (cancelled.current) return;
    if (!res.ok) { setPhase('unavailable'); say(res.error, 'error'); return; }
    if (res.file_name) setFileName(res.file_name);
    if (res.status !== 'done') { setPhase('unavailable'); say(rulesStatusMessage(res), 'error'); return; }
    const content = res.content ?? '';
    setOnNode(res.exists === false ? '' : content);
    setEditor(content);
    setPhase('ready');
    say(rulesStatusMessage(res), 'muted');
  }, [cfg, node, session]);

  useEffect(() => { void runRead(); }, [runRead]);

  const runSave = async () => {
    if (phase !== 'ready') return;
    setPhase('saving');
    say(`正在写入 ${fileName}…`);
    const enq = await writeNodeRulesFile(cfg, node, editor);
    if (cancelled.current) return;
    if (!enq.ok) { setPhase('ready'); say(enq.error, 'error'); return; }
    const res = await waitForRulesFileResult(cfg, enq.request_id, { nextDelayMs: nextPollDelayMs, isTerminal, isCancelled: () => cancelled.current });
    if (cancelled.current) return;
    setPhase('ready');
    if (!res.ok) { say(res.error, 'error'); return; }
    if (res.file_name) setFileName(res.file_name);
    if (res.status !== 'done') { say(rulesStatusMessage(res), 'error'); return; }
    setOnNode(editor);
    say(rulesStatusMessage(res), 'ok');
  };

  const dirty = phase === 'ready' && hasUnsavedChanges(editor, onNode);
  const toneColor = messageTone === 'ok' ? colors.running : messageTone === 'error' ? colors.failed : colors.textMuted;

  return (
    <View style={{ paddingTop: spacing.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: spacing.sm }}>
        <Text style={{ color: colors.textMuted, fontSize: 13 }}>节点规则</Text>
        <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }} selectable>{fileName}</Text>
      </View>
      <View style={{ backgroundColor: colors.card, borderRadius: 12, padding: spacing.lg, gap: spacing.md }}>
        <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>
          这是节点工作目录里的 {fileName}，节点每次开工都会读它。保存会直接覆盖节点机器上的这个文件；文件名和位置由节点自己决定，这里改不了。
        </Text>
        {phase === 'loading' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <ActivityIndicator color={colors.accent} />
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>{message}</Text>
          </View>
        ) : null}
        {phase === 'ready' || phase === 'saving' ? (
          <TextInput
            value={editor}
            onChangeText={setEditor}
            editable={phase === 'ready'}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={`# ${fileName}\n\n（还没有内容，写点规则再保存）`}
            placeholderTextColor={colors.textMuted}
            textAlignVertical="top"
            style={{
              color: colors.text,
              borderWidth: 1,
              borderColor: dirty ? colors.accent : colors.border,
              borderRadius: 8,
              padding: spacing.md,
              minHeight: 180,
              fontSize: 13,
              lineHeight: 19,
              fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
            }}
          />
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm }}>
          <Pressable style={[styles.retryBtn, phase === 'loading' || phase === 'saving' ? { opacity: 0.4 } : null]} disabled={phase === 'loading' || phase === 'saving'} onPress={() => void runRead()}>
            <Text style={styles.retryBtnText}>重新读取</Text>
          </Pressable>
          <Pressable style={[styles.retryBtn, !dirty && { opacity: 0.4 }]} disabled={!dirty} onPress={() => void runSave()}>
            <Text style={{ color: colors.accent, fontWeight: '600' }}>{phase === 'saving' ? '保存中…' : dirty ? '保存到节点' : '已是最新'}</Text>
          </Pressable>
        </View>
        {phase !== 'loading' && message ? <Text style={{ color: toneColor, fontSize: 12, lineHeight: 18 }}>{message}</Text> : null}
      </View>
    </View>
  );
}
