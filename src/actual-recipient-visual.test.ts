// 这道门原来断言的是「源码里出现过 '#effaf3'」。它是随「软化」那次一起加的
// (0.2.38 发黑横幅时它还不存在,所以那次不能怪它),用途是把当时选定的几个色值
// 钉住。问题在形状:那是**存在性**判据 —— 换成另一组同样难看的颜色、或者让提示
// 条在每次成功发送后常驻不走,只要那几个字符串还在文件里,它都照样绿。
//
// 改成两层:决定「弹不弹、弹什么」的是纯函数,直接驱动它;配色按**属性**检查
// (浅色主题的底必须真的浅、标题对底的对比度必须够、不许出现纯黑),而不是比对
// 色值字符串 —— 换一个同样难看的颜色时,属性判据会红,字符串判据不会。
import fs from 'node:fs';
import {
  NOTICE_AUTO_DISMISS_MS,
  noticePalette,
  sendNoticeFor,
  type SendConfirmation,
  type SendNoticeKind,
} from './actual-recipient';

let passed = 0;
const ck = (label: string, ok: boolean) => {
  if (!ok) { console.error(`FAIL: ${label}`); process.exit(1); }
  passed++; console.log(`PASS: ${label}`);
};

const component = fs
  .readFileSync(new URL('./ActualRecipientNotice.tsx', import.meta.url), 'utf8')
  .replace(/\r\n?/g, '\n');
const screen = fs
  .readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8')
  .replace(/\r\n?/g, '\n');

const confirmation = (over: Partial<SendConfirmation> = {}): SendConfirmation => ({
  actualRecipient: { alias: 'TM运维', toNodeId: 'node_1', networkId: 'net_a' },
  queued: false,
  ...over,
});

// ---- 1. 成功即安静(行为) ----------------------------------------------------

ck('送到你写的那个别名时,不弹任何东西',
  sendNoticeFor(confirmation(), 'TM运维') === null);

ck('旧版 Hub 不报告接收方时也不弹 —— 那是诊断信息,不是用户动作点',
  sendNoticeFor(confirmation({ actualRecipient: null }), 'TM运维') === null);

ck('别名两侧的空白不会被当成换了个人',
  sendNoticeFor(confirmation(), '  TM运维  ') === null);

// ---- 2. 值得打断的两种情况(行为) -------------------------------------------

const queued = sendNoticeFor(confirmation({ queued: true }), 'TM运维');
ck('对方离线导致排队时会说一声', queued?.kind === 'queued');
ck('排队提示点名是谁离线', queued?.detail.includes('TM运维') === true);

const queuedUnknown = sendNoticeFor(confirmation({ queued: true, actualRecipient: null }), 'TM运维');
ck('接收方未知时排队提示仍然成立,且不编造名字',
  queuedUnknown?.kind === 'queued' && !queuedUnknown.detail.includes('undefined'));

const rerouted = sendNoticeFor(confirmation(), '老名字');
ck('Hub 改投到别的节点时会说一声', rerouted?.kind === 'rerouted');
ck('改投提示同时给出你写的和实际送到的',
  rerouted?.detail.includes('老名字') === true && rerouted.detail.includes('TM运维') === true);
ck('排队和改投是两种不同的提示', queued?.kind !== rerouted?.kind);

// ---- 3. 配色按属性检查 -------------------------------------------------------

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
];
/** WCAG 相对亮度。 */
const luminance = (hex: string): number => {
  const [r, g, b] = rgb(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const KINDS: SendNoticeKind[] = ['queued', 'rerouted'];
const MODES = ['light', 'dark'] as const;
const every = KINDS.flatMap(kind => MODES.map(mode => ({ kind, mode, p: noticePalette(kind, mode) })));

ck('每格配色都是合法的六位色值',
  every.every(({ p }) => [p.surface, p.outline, p.title, p.detail, p.dot].every(c => /^#[0-9a-f]{6}$/i.test(c))));

ck('浅色主题的底真的是浅的',
  every.filter(e => e.mode === 'light').every(e => luminance(e.p.surface) > 0.75));

ck('深色主题的底真的是深的',
  every.filter(e => e.mode === 'dark').every(e => luminance(e.p.surface) < 0.1));

// Vincent 报的就是这个:浅色 app 里一条纯黑横幅。
ck('任何一格都不许出现纯黑或纯白',
  every.every(({ p }) => [p.surface, p.outline, p.title, p.detail, p.dot]
    .every(c => !['#000000', '#ffffff'].includes(c.toLowerCase()))));

ck('标题对底的对比度达到 WCAG AA(4.5:1)',
  every.every(e => contrast(e.p.title, e.p.surface) >= 4.5));

ck('次要文字对底至少达到 3:1,不至于糊成一片',
  every.every(e => contrast(e.p.detail, e.p.surface) >= 3));

ck('边框能从底上看出来',
  every.every(e => contrast(e.p.outline, e.p.surface) >= 1.15));

ck('同一种提示在两个主题下配色不同',
  KINDS.every(kind => noticePalette(kind, 'light').surface !== noticePalette(kind, 'dark').surface));

ck('排队和改投在同一主题下能分辨',
  MODES.every(mode => noticePalette('queued', mode).surface !== noticePalette('rerouted', mode).surface));

// ---- 4. 形态:不是横幅 -------------------------------------------------------

ck('提示条限宽居中,不铺满整行',
  /alignSelf: 'center'/.test(component) && /maxWidth: \d+/.test(component));

ck('提示条会自己走,不需要用户点掉',
  /setTimeout\(onDismiss, NOTICE_AUTO_DISMISS_MS\)/.test(component));

ck('计时器在卸载和换提示时被清掉',
  /return \(\) => clearTimeout\(timer\)/.test(component));

ck('自动消失时长在 1–6 秒之间',
  NOTICE_AUTO_DISMISS_MS >= 1000 && NOTICE_AUTO_DISMISS_MS <= 6000);

ck('组件不再自己挑颜色,颜色来自可被断言的调色板',
  /noticePalette\(notice\.kind,/.test(component) && !/'#[0-9a-f]{6}'/i.test(component));

// ---- 5. 接线:屏幕必须走这个决定,而不是拿到确认就渲染 ------------------------

ck('ChatScreen 通过 sendNoticeFor 决定弹不弹',
  /sendNoticeFor\(sendConfirmation, alias\)/.test(screen));

ck('ChatScreen 渲染的是决定的结果,不是原始确认',
  /<ActualRecipientNotice notice=\{sendNotice\}/.test(screen)
    && !/<ActualRecipientNotice confirmation=/.test(screen));

console.log(`actual recipient visual contract: ${passed} checks passed`);
