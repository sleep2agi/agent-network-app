import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// admin 2026-11-19：深色模式下没写 color 的 <Text> 是黑字黑底（节点「密钥」页的「正在读取…」、输入框标签）。
// 顶层 Text 默认主题正文色；嵌套 Text 不加，继续继承外层颜色。
const src = readFileSync(new URL('./ui-text.tsx', import.meta.url), 'utf8');
assert.match(src, /import \{ colors \} from '\.\/theme'/);
assert.match(src, /nested \? style : \[\{ color: colors\.text \}, style\]/, 'top-level Text gets colors.text before caller style');

const secrets = readFileSync(new URL('./ScopedSecretsSection.tsx', import.meta.url), 'utf8');
assert.match(secrets, /<ActivityIndicator color=\{colors\.textMuted\}\/><Text style=\{\{color:colors\.textMuted\}\}>/, 'loading row is tinted, not default black');

console.log('ui-text-default-color: ok');
