// 「去会话」落到那一条消息上(board #463)。ck 风格,自执行。
// 判据(message-focus.ts nextFocusStep)+ 接线:每个带「这条消息」的入口都走 ChatScreen 的同一个 goToMessage / focusTaskId。
// 真渲染(目标回复的第一行在会话可视区里、短暂高亮、往前拉过、找不到时提示)在 tests/test-goto-message/drive.mjs。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOCUS_MAX_LIMIT, FOCUS_PAGE_STEP, nextFocusStep } from './message-focus';

let p = 0, n = 0;
const ck = (name: string, ok: boolean) => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}`); };
const here = import.meta.dir;
const read = (rel: string) => readFileSync(join(here, rel), 'utf8').replace(/\r\n?/g, '\n');
const base = { index: -1, ready: true, hasOlder: true, loading: false, limit: 20 };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log('判据');
ck('已加载 ⇒ 定位到那个下标', eq(nextFocusStep({ ...base, index: 7 }), { kind: 'locate', index: 7 }));
ck('已加载(缓存里就有,会话还没拉回来)⇒ 也直接定位', eq(nextFocusStep({ ...base, index: 3, ready: false }), { kind: 'locate', index: 3 }));
ck('没加载、会话还没拉回来 ⇒ 等(不能拿空列表判「找不到」)', nextFocusStep({ ...base, ready: false }).kind === 'wait');
ck('没加载、正在往前拉 ⇒ 等', nextFocusStep({ ...base, loading: true }).kind === 'wait');
ck('没加载、还有更早的 ⇒ 多拉一步', eq(nextFocusStep(base), { kind: 'load', limit: 20 + FOCUS_PAGE_STEP }));
ck('步长比聊天翻页(20)大', FOCUS_PAGE_STEP > 20);
ck('拉到上限前最后一步截在上限', eq(nextFocusStep({ ...base, limit: FOCUS_MAX_LIMIT - 10 }), { kind: 'load', limit: FOCUS_MAX_LIMIT }));
ck('到上限还没有 ⇒ 找不到', nextFocusStep({ ...base, limit: FOCUS_MAX_LIMIT }).kind === 'missing');
ck('到聊天记录起点还没有 ⇒ 找不到', nextFocusStep({ ...base, hasOlder: false, limit: 140 }).kind === 'missing');
// 一路走下去一定停:从第一页开始,每一步要么定位、要么 limit 变大、要么停。
let limit = 20, steps = 0;
for (;;) { const s = nextFocusStep({ ...base, limit }); if (s.kind !== 'load') break; ck(`第 ${++steps} 步 limit 变大`, s.limit > limit); limit = s.limit; if (steps > 50) break; }
ck('有限步内停下(≤ 10 步)', steps <= 10 && limit === FOCUS_MAX_LIMIT);
ck('上限不超过 hub 一次给的条数(200),不然「不满 limit」会被当成聊天记录起点', FOCUS_MAX_LIMIT <= 200);

console.log('接线:ChatScreen');
const chat = read('ChatScreen.tsx');
ck('focusTaskId 交给同一个 focusTarget', chat.includes('setFocusTarget(focusTaskId)'));
ck('按 nextFocusStep 走(定位 / 多拉 / 提示)', chat.includes('nextFocusStep({ index: messages.findIndex(m => msgKey(m) === focusTarget)') && chat.includes("setComposerNotice(t('chat.focusNotFound'))") && chat.includes('void load(step.limit)'));
ck('多拉时记下新的 limit(轮询不把窗口缩回去)', chat.includes('limitRef.current = step.limit;'));
ck('「去会话」顶边对齐(回复比一屏高也看得到开头)', chat.includes("locateKey(focusTarget, 'top')") && chat.includes("align === 'top' ? 1 : 0.5"));
ck('补滚(onScrollToIndexFailed)沿用同一个对齐', chat.includes('viewPosition: locateViewPosRef.current }'));
ck('回复引用条也走 goToMessage(引用的那条不在已加载的页里也找得到)', chat.includes('onPress={() => goToMessage(replyQuote.targetKey)}') && !chat.includes('onPress={() => locateKey(replyQuote.targetKey)}'));
ck('高亮进 extraData(不然格子不重画、高亮画不出来)', chat.includes('extraData={highlightExtra}') && chat.includes('useMemo(() => ({ highlight, highlightTick }), [highlight, highlightTick])'));
ck('滚完再计高亮时间', chat.includes('LOCATE_SETTLE_MS + 2100') && chat.includes('{ key, at: Date.now() } : h'));
ck('提示文案中英都有', /'chat\.focusNotFound': \['[^']+', '.+'\]/.test(read('i18n-chat.ts')));

console.log('接线:入口');
const app = readFileSync(join(here, '..', 'App.tsx'), 'utf8');
ck('定时任务两处挂载都带 focusTaskId', app.split("onOpenChat={(alias, focusTaskId) => setScreen({ name: 'chat', alias, focusTaskId })} />").length - 1 === 2);
ck('事件流(日志)两处挂载都带 focusTaskId', (app.match(/<LogsScreen[\s\S]{0,200}?onOpenChat=\{\(alias, focusTaskId\) => setScreen\(\{ name: 'chat', alias, focusTaskId \}\)\}/g) ?? []).length === 2);
ck('没有一处 LogsScreen 还丢掉 taskId', !/<LogsScreen[\s\S]{0,200}?onOpenChat=\{alias => /.test(app));
const logs = read('LogsScreen.tsx');
ck('事件流点一行 ⇒ onOpenChat(alias, taskId)', logs.includes('onOpenChat(target.alias, target.taskId)'));
ck('event-feed-model 的 chat 目标带 taskId', read('event-feed-model.ts').includes("return { kind: 'chat', alias: ev.to, ...focus }"));

console.log(`\n${p}/${n} passed`);
if (p !== n) process.exit(1);
