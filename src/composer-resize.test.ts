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
} = await import('./composer-resize');

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

console.log(`composer resize: ${ck} checks passed`);
