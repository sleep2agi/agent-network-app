// 「同一会话里出现一条自己发出去的 agent 回复」—— 转发策略的守护。
// 现场（2026-11-12）：chuqi 把某条 agent 回复转发回同一会话，库里多了一条 chuqi→该 agent 的 task，
// content 就是那段回复原文（含 `[via …]` 前缀）。用户看到的效果是「我说了一段 agent 的话」，事后查不清谁说的。
import { readFileSync } from 'node:fs';

let pass = 0;
const fails: string[] = [];
const ck = (name: string, ok: boolean) => { if (ok) pass += 1; else fails.push(name); };

const screen = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('./i18n-chat.ts', import.meta.url), 'utf8');

// 1) 选择项必须记住它来自「自己发的」还是「agent 回复」——否则转发策略无从判断。
ck('selection carries its origin kind', /kind\?: 'sent' \| 'reply'/.test(screen));
ck('openSelect records the bubble tone as kind', /selection: \{ \.\.\.selection, kind: tone \}/.test(screen));

// 2) 转发 agent 回复时，目标列表里不能有当前会话
ck('reply forward excludes the same conversation from targets',
  /forwardingReply/.test(screen) && /session\.alias === alias/.test(screen));

// 3) 发送前兜底：即使被绕过，也不能静默回灌
ck('send-time guard blocks reply -> same conversation',
  /selection\.kind === 'reply' && target === alias/.test(screen) && screen.includes("t('chat.forwardReplySameChat')"));

// 4) 文案必须说清「不能」与「去哪」——不能只说失败
ck('copy explains the rule and the way out',
  i18n.includes("chat.forwardReplySameChat") && /不能转发回同一个会话/.test(i18n) && /别的节点/.test(i18n));

console.log(`chat-forward-guard: ${pass}/${pass + fails.length}`);
if (fails.length) { console.error('FAILED:', fails.join(' | ')); process.exit(1); }
