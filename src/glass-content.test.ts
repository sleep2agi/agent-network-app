import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { glassContentCss } from './glass-content-css';

// 只取原子 class（r-…），丢掉 View 基础 class（css-…）和奇怪的名字；规则限定在桌面内容区里。
const css = glassContentCss(['css-g5y9jx', 'r-1w914xz', 'r-13awgt0', 'bad name', 'r-a;b']);
assert.equal(css, '[data-glass-content] .r-1w914xz{background-color:transparent !important}\n[data-glass-content] .r-13awgt0{background-color:transparent !important}');
assert.equal(glassContentCss([]), '');

// 接线：桌面内容区用 GlassContent 包住（admin 2026-11-19「任务这边也就是一块白」）。
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
assert.match(app, /<GlassContent style=\{desktopStyles\.content\}>[\s\S]*\{content\}<ShortcutToast text=\{shortcutToast\} \/>\s*<\/GlassContent>/);
const comp = readFileSync(new URL('./glass-content.tsx', import.meta.url), 'utf8');
assert.match(comp, /backgroundColor: colors\.bg/);
assert.match(comp, /backgroundColor: colors\.listBg/);
assert.match(comp, /Platform\.OS !== 'web'/);
console.log('glass-content: ok');
