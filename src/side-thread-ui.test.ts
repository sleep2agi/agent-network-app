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
check('显式带回使用原 sourceThreadId，不自动写回', drawer.includes('destinationThreadId: card.sourceThreadId') && drawer.includes('actions.bringBack'));
check('关闭 drawer 不调用 cancel/archive', drawer.includes('onRequestClose={() => setVisible(false)}'));
check('问题和卡片由 drawer 自有 state 持有', drawer.includes("const [question, setQuestion]") && drawer.includes("const [cards, setCards]"));
check('切换 agent/窗口后迟到 create/action 不能写入新 owner', (drawer.match(/generation !== generationRef\.current/g) ?? []).length >= 7 && drawer.includes('return () => { generationRef.current += 1; }'));
check('ambiguous 不冒充 failed，提示等待/刷新', drawer.includes("error.code === 'SIDE_THREAD_AMBIGUOUS'") && drawer.includes('正在确认运行状态') && drawer.includes('请等待或刷新'));

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
