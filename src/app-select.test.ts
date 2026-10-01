// AppSelect(设置里的下拉选择,替掉 DOM <select>)—— 键盘逻辑 + 组件契约的静态检查。
// 几何(行与同页控件对齐、浮层在窗口内、电平条可见)在 tests/test-mic-device-settings/drive.mjs 真渲染量。
import { readFileSync } from 'node:fs';
import { initialActive, stepOption, type AppSelectOption } from './app-select-model';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? '✓' : '✗'} ${name}`); };

const opts: AppSelectOption[] = [
  { value: '', label: '跟随系统默认' },
  { value: 'a', label: 'A', disabled: true },
  { value: 'b', label: 'B' },
  { value: 'c', label: 'C' },
];
ck('↓ 跳过禁用项', stepOption(opts, 0, 1) === 2);
ck('↑ 跳过禁用项', stepOption(opts, 2, -1) === 0);
ck('↓ 到底停住', stepOption(opts, 3, 1) === 3);
ck('↑ 到顶停住', stepOption(opts, 0, -1) === 0);
ck('Home = 第一个可选', stepOption(opts, -1, 1) === 0);
ck('End = 最后一个可选', stepOption(opts, opts.length, -1) === 3);
ck('Home 在首项禁用时跳过它', stepOption([{ value: 'x', label: 'x', disabled: true }, { value: 'y', label: 'y' }], -1, 1) === 1);
ck('空列表不越界', stepOption([], -1, 1) === 0);
ck('打开时高亮当前值', initialActive(opts, 'c') === 3);
ck('当前值是空串(跟随系统默认)也能高亮', initialActive(opts, '') === 0);
ck('当前值不在列表 → 第一个可选', initialActive(opts, 'gone') === 0);
ck('当前值被禁用 → 第一个可选', initialActive(opts, 'a') === 0);

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const src = read('./AppSelect.tsx');
for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Home', 'End', 'Tab']) ck(`浮层键盘: ${key}`, src.includes(`'${key}'`));
// Esc 走 escape-close.ts(keyup 才关、吞掉 keyup,不连带关下面那层;select-menu-esc.test.ts 测行为)。
ck('浮层键盘: Escape(listenEscapeClose)', /listenEscapeClose\(\(\) => keyRef\.current\.onClose\(true\)\)/.test(src));
ck('键盘焦点描边(state.focused → outline)', /state\.focused[^\n]*focusRing\(\)/.test(src) && /outlineWidth: 2/.test(src));
ck('选中项有 ✓', (src.match(/name="checkmark"/g) ?? []).length >= 2);
ck('点浮层外面关(铺满的 scrim)', /StyleSheet\.absoluteFill\} onPress=\{\(\) => onClose\(false\)\}/.test(src));
ck('关了焦点回到行上', /ref\.current\?\.focus\?\.\(\)/.test(src));
ck('手机 = SettingsRow + 底部面板 + 取消', src.includes('<SettingsRow') && src.includes('<ActionSheet') && src.includes('-cancel'));
ck('颜色全走主题 token(无 #hex)', !/#[0-9a-fA-F]{3,8}\b/.test(src.replace(/\/\/.*$/gm, '')));

const mic = read('./MicDeviceSetting.tsx');
ck('麦克风用 AppSelect', mic.includes('<AppSelect'));
ck('窄页(phone)走底部面板', /sheet=\{phone\}/.test(mic));
ck('电平条 ≥ 4 高', Number(/meter: \{[^}]*height: (\d+)/.exec(mic)?.[1] ?? 0) >= 4);
ck('电平条只在已授权时画、开流', /useInputLevel\(granted,/.test(mic) && /granted \? <MicLevelBar/.test(mic));
ck('说明一行', /numberOfLines=\{1\} testID="voice-mic-hint"/.test(mic));

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
