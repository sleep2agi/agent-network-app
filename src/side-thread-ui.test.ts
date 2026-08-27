import fs from 'node:fs';

let passed = 0;
let total = 0;
const check = (name: string, condition: boolean) => {
  total += 1;
  if (condition) { passed += 1; console.log('✅', name); }
  else console.error('❌', name);
};

const chat = fs.readFileSync('src/ChatScreen.tsx', 'utf8');
const drawer = fs.readFileSync('src/SideThreadDrawer.tsx', 'utf8');
const actionController = fs.readFileSync('src/side-thread-action-controller.ts', 'utf8');
const app = fs.readFileSync('App.tsx', 'utf8');
const props = drawer.slice(drawer.indexOf('interface Props'), drawer.indexOf("type CapabilityView"));

check('共享 ChatScreen 同时覆盖独立窗口/桌面主窗口/移动端', (app.match(/<ChatScreen/g) ?? []).length === 3);
check('共享 ChatScreen 只挂一份 SideThreadDrawer', (chat.match(/<SideThreadDrawer/g) ?? []).length === 1);
check('+ 菜单明确提供 BTW 入口', chat.includes('accessibilityLabel="新建 BTW 旁路线程"') && chat.includes('不打断、不 steer 当前主任务'));
check('首 token parser 在普通 sendTask 前截获 BTW', chat.indexOf('parseBtwFirstToken(draft)') < chat.indexOf('outboxAdd({'));
check('BTW 分支不生成主会话 optimistic echo', chat.includes('Do not add an optimistic') && chat.includes('main-chat bubble and never call sendTask as a fallback.'));
check('SideThreadDrawer 无主 draft/scroll/title/selection 写入能力', !/setDraft|setMessages|listRef|setScreen|setSelection/.test(props));
check('BTW 异步状态完全封装在 drawer，不接普通 sendTask', !/\bsendTask\s*\(/.test(drawer) && !drawer.includes('/api/task'));
check('unsupported UI 明说不降级', drawer.includes('不会降级为普通发送、优先任务或 steer。'));
for (const state of ['creating', 'running', 'reconciling', 'succeeded', 'failed', 'cancelled', 'archived']) {
  check(`card 状态机包含 ${state}`, fs.readFileSync('src/side-thread-model.ts', 'utf8').includes(`'${state}'`));
}
for (const action of ['cancel', 'retry', 'archive', 'bring-back']) {
  check(`drawer 接入 ${action}`, drawer.includes(`'${action}'`));
}
check('drawer 把动作交给无 RN 行为 controller', drawer.includes('createSideThreadActionController({') && drawer.includes('actionController.run(card.id, action)'));
check('关闭 drawer 不调用 cancel/archive', drawer.includes('onRequestClose={closeDrawer}') && !/const closeDrawer[\s\S]{0,300}client\.(cancel|archive)/.test(drawer));
check('问题和卡片由 drawer 自有 state 持有', drawer.includes("const [question, setQuestion]") && drawer.includes("const [cards, setCards]"));
check('render-time scope gate 在 effect 前阻止旧 owner 写入', drawer.includes('scopeGate.render(scopeKey)') && drawer.includes('requestIsCurrent'));
check('每 scope/lane request sequence 拒绝乱序 response', drawer.includes('scopeGate.begin(scopeKey, lane)') && drawer.includes('beginRequest(\'list\')') && drawer.includes('beginRequest(\'capability\')'));
check('controller 是唯一动作 dispatch owner', !/client\.(cancel|retry|archive|bringBack|get)\(/.test(drawer) && actionController.includes('dependencies.client.bringBack'));
check('controller hydration 接回 drawer state', drawer.includes('actionController.reconcile(cards)') && drawer.includes('updateCards: update => setCards(update)'));
check('/btw 附件上传后显式传 SideThread 并清 composer', chat.includes('attachments = uploaded.map(item => ({ fileId: item.file_id }))') && chat.includes('setAttached([])') && chat.includes('attachments }));'));
check('行为 controller 无 React Native 依赖', !actionController.includes("from 'react-native'") && !actionController.includes("from 'react'"));
check('Modal focus/restore/keyboard/safe-area 已接入', drawer.includes('questionInputRef.current?.focus()') && drawer.includes('restoreFocusRef?.current?.focus()') && drawer.includes('<KeyboardAvoidingView') && drawer.includes('insets.bottom'));
check('dialog/state/live region 无障碍语义已接入', drawer.includes('role="dialog"') && drawer.includes('accessibilityState={{ busy:') && drawer.includes('accessibilityLiveRegion="polite"') && drawer.includes('accessibilityLiveRegion="assertive"'));

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
