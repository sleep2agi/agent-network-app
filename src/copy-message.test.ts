// 2026-09-16 Vincent:「需要支持一下复制消息的按钮」—— 动作菜单「复制」+ 桌面悬停复制按钮 + 「已复制」提示。
import fs from 'node:fs';
import { messageMenuGroups as menuGroups } from './message-menu-model';
import path from 'node:path';
import { copyTextOf, copiedToastVisible, COPIED_TOAST_MS } from './chat-actions';
let p = 0, t = 0; const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

ck('copyTextOf 去掉开头引用块只留正文', copyTextOf('「@通信龙: 已合」\n好的,继续') === '好的,继续');
ck('copyTextOf 保留正文换行', copyTextOf('一\n二') === '一\n二');
ck('copyTextOf 只有引用没正文 → 退回引用文本', copyTextOf('「@通信龙: 已合」') === '通信龙: 已合');
ck('copyTextOf 空 → 空串', copyTextOf('') === '' && copyTextOf(undefined) === '');
ck('toast 1.4s 内可见', copiedToastVisible(1000, 1000 + COPIED_TOAST_MS - 1) === true);
ck('toast 到点消失', copiedToastVisible(1000, 1000 + COPIED_TOAST_MS) === false);
ck('toast 未复制过不显示', copiedToastVisible(null, 5000) === false);

const src = fs.readFileSync(path.join(__dirname, 'ChatScreen.tsx'), 'utf8');
// 0.2.78:菜单项由 message-menu-model 产出,第一组第一项仍是「复制」——断言落在模型上。
ck('动作菜单第一项是「复制」', menuGroups({ hasText: true }).at(0)!.at(0)!.key === 'copy');
ck('复制项带无障碍名', src.includes("item.key === 'copy' ? '复制消息' : item.label"));
ck('复制走 expo-clipboard,失败退回 navigator.clipboard', src.includes("import * as Clipboard from 'expo-clipboard';") && src.includes('await Clipboard.setStringAsync(value);') && src.includes('navigator?.clipboard?.writeText?.(value)'));
ck('复制的是 copyTextOf(去引用块)', src.includes('const copyMessage = (text: string) => copyValue(copyTextOf(text));'));
// 0.2.72:第三种气泡(别的节点派来的任务,收到侧)也带复制按钮 → 3 处
ck('桌面端三种气泡悬停都有复制按钮', src.split('accessibilityLabel="复制消息"').length === 5 && src.includes('hoverKey === `${msgKey(item)}:sent`') && src.includes('hoverKey === `${msgKey(item)}:reply`'));
ck('悬停按钮只在桌面端', src.includes('desktop && hoverKey ==='));
ck('「已复制」提示到点自动清', src.includes('setTimeout(() => setCopiedAt(null), COPIED_TOAST_MS)') && src.includes('copiedToastVisible(copiedAt, Date.now())'));

console.log(`\n${p}/${t} passed`); process.exit(p === t ? 0 : 1);
