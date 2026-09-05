import { strict as assert } from 'node:assert';

const values = new Map<string, string>();
(globalThis as any).__TAURI_INTERNALS__ = {};
(globalThis as any).localStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
};

const {
  COMPOSER_HEIGHT_MIN, COMPOSER_LIST_RESERVE, COMPOSER_CHROME, COMPOSER_HEIGHT_KEY,
  composerHeightBounds, clampComposerHeight, composerHeightFromDrag, inputMaxHeight,
  parseStoredComposerHeight, loadComposerHeight, saveComposerHeight,
  composerDragHandlers, lockDocumentSelection,
} = await import('./composer-resize');
const { readFileSync } = await import('node:fs');

let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; };

// 边界:根高度 800 → max = 600;根高度未知 → 宽松上界;根高度太矮 → max 退化为 min
check(composerHeightBounds(800).max === 800 - COMPOSER_LIST_RESERVE, 'max = root - reserve');
check(composerHeightBounds(800).min === COMPOSER_HEIGHT_MIN, 'min = 148');
check(composerHeightBounds(0).max >= COMPOSER_HEIGHT_MIN, 'unknown root keeps a usable max');
check(composerHeightBounds(300).max === COMPOSER_HEIGHT_MIN, 'short window: max collapses to min (not below)');

// clamp:上下越界、非数字、四舍五入
check(clampComposerHeight(50, 800) === COMPOSER_HEIGHT_MIN, 'below min → min');
check(clampComposerHeight(5000, 800) === 600, 'above max → max');
check(clampComposerHeight(Number.NaN, 800) === COMPOSER_HEIGHT_MIN, 'NaN → min');
check(clampComposerHeight(200.6, 800) === 201, 'rounds');

// 拖拽方向:向上(dy<0)变高,向下变矮,到边停住
check(composerHeightFromDrag(200, -50, 800) === 250, 'drag up grows');
check(composerHeightFromDrag(200, 30, 800) === 170, 'drag down shrinks');
check(composerHeightFromDrag(160, 100, 800) === COMPOSER_HEIGHT_MIN, 'drag down past min stops at min');
check(composerHeightFromDrag(580, -100, 800) === 600, 'drag up past max stops at max');

// 输入框可用高度
check(inputMaxHeight(148) === 148 - COMPOSER_CHROME, 'input max = composer - chrome');
check(inputMaxHeight(10) === 21, 'never below one line');

// 持久化:没存过 → null;存了 → 读回;坏值 → null
check(loadComposerHeight() === null, 'fresh desktop: null');
check(saveComposerHeight(260) === true, 'save ok');
check(values.get(COMPOSER_HEIGHT_KEY) === '260', 'stored as integer string');
check(loadComposerHeight() === 260, 'roundtrip');
check(saveComposerHeight(Number.NaN) === false && loadComposerHeight() === 260, 'NaN save refused, old value kept');
check(parseStoredComposerHeight('abc') === null, 'garbage → null');
check(parseStoredComposerHeight('-5') === null, 'negative → null');
check(parseStoredComposerHeight('301.4') === 301, 'float string rounds');

// 非桌面(无 __TAURI_INTERNALS__)→ undefined / false
delete (globalThis as any).__TAURI_INTERNALS__;
check(loadComposerHeight() === undefined, 'non-desktop load → undefined');
check(saveComposerHeight(200) === false, 'non-desktop save → false');

// ---- 分隔条拖拽 handlers(2026-09-05 Vincent:向上拖全选 + 拖不动) ----
{
  let height = 200;
  let root = 800;
  const saved: number[] = [];
  let locks = 0;
  let unlocks = 0;
  const h = composerDragHandlers({
    getHeight: () => height,
    getRootHeight: () => root,
    setHeight: (v) => { height = v; },
    save: (v) => { saved.push(v); },
    lockSelection: () => { locks++; return () => { unlocks++; }; },
  });
  // 按下:阻止浏览器默认动作(= 不开始选区),并且要 responder
  let prevented = 0;
  const event = { preventDefault: () => { prevented++; } };
  check(h.onStartShouldSetPanResponder(event) === true && prevented === 1, 'start claims responder and preventDefaults the mousedown');
  check(h.onStartShouldSetPanResponder() === true, 'start without event object still claims (native)');
  check(h.onPanResponderTerminationRequest() === false, 'refuses to hand the gesture to the ScrollView');
  // 一次完整拖拽:start 是按下时的高度(不是创建 handlers 时的),dy 是累计值
  height = 240;
  h.onPanResponderGrant(event);
  check(locks === 1, 'grant locks page selection');
  h.onPanResponderMove(undefined, { dy: -10 });
  check(height === 250, 'move 1: start 240 + 10');
  h.onPanResponderMove(undefined, { dy: -60 });
  check(height === 300, 'move 2: still relative to the grant height, not to the previous move (this is the 0.2.46 stall)');
  h.onPanResponderMove(undefined, { dy: -900 });
  check(height === 600, 'move past max clamps to root - reserve');
  h.onPanResponderRelease(undefined, { dy: -100 });
  check(height === 340 && saved.length === 1 && saved[0] === 340, 'release sets + saves the final height once');
  check(unlocks === 1, 'release restores page selection');
  // 第二次拖拽从新高度开始;被打断(terminate)也要还原选区并保存当前值
  h.onPanResponderGrant(event);
  h.onPanResponderMove(undefined, { dy: 40 });
  check(height === 300, 'second drag starts from 340');
  h.onPanResponderTerminate();
  check(unlocks === 2 && saved[1] === 300, 'terminate restores selection and saves current height');
  // 窗口变矮后 grant 时按新上界 clamp
  root = 400; height = 500;
  h.onPanResponderGrant(event);
  h.onPanResponderMove(undefined, { dy: 0 });
  check(height === 200, 'grant reads root height live: 500 clamps to 400-200');
}

// lockDocumentSelection:整页禁选 + 清现有选区 + 还原;没有 document 时 no-op
{
  let cleared = 0;
  const doc = { body: { style: { userSelect: 'text', webkitUserSelect: '' } as Record<string, string> }, getSelection: () => ({ removeAllRanges: () => { cleared++; } }) };
  const restore = lockDocumentSelection(doc);
  check(doc.body.style.userSelect === 'none' && doc.body.style.webkitUserSelect === 'none', 'lock sets user-select:none on body');
  check(cleared === 1, 'lock clears an existing selection');
  check(typeof restore === 'function', 'lock returns a restore function');
  (restore as () => void)();
  check(doc.body.style.userSelect === 'text' && doc.body.style.webkitUserSelect === '', 'restore puts the previous values back');
  check(lockDocumentSelection(undefined) === undefined, 'no document → no-op');
}

// ChatScreen 接线契约(源码扫描,能抓住的回归:PanResponder 又按高度重建 / 分隔条丢 userSelect)
{
  const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const creates = chat.match(/PanResponder\.create\(/g) ?? [];
  check(creates.length === 1, 'ChatScreen creates exactly one PanResponder');
  check(chat.includes('PanResponder.create(composerDragHandlers({'), 'the divider PanResponder is built from composerDragHandlers');
  const memo = chat.slice(chat.indexOf('PanResponder.create(composerDragHandlers({'));
  const memoEnd = memo.indexOf('})), [');
  check(memoEnd > 0 && memo.slice(memoEnd, memoEnd + 9) === '})), []);', 'the divider PanResponder useMemo has EMPTY deps (0.2.46 had [composerHeightRaw] → stalls mid-drag)');
  check(chat.includes('getHeight: () => composerHeightRawRef.current'), 'height is read through a ref, not captured');
  const divider = chat.slice(chat.indexOf('composerDivider: {'), chat.indexOf('composerDividerGrip:'));
  check(divider.includes("userSelect: 'none'") && divider.includes("cursor: 'ns-resize'"), 'divider style: userSelect none + ns-resize');
  check(chat.includes("lockSelection: Platform.OS === 'web' ? lockDocumentSelection : undefined"), 'page selection lock wired on web only');
}

console.log(`composer resize: ${ck} checks passed`);
