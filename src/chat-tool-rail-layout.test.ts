import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHAT_MIN_WIDTH_WITH_PANEL, CHAT_TOOL_RAIL_WIDTH, COMPOSER_HINT_MIN_WIDTH, chatToolRailReserve, composerShowsShortcutHint, dockedPanelWidth, PANEL_MIN_WIDTH } from './chat-tool-rail-layout';
const chatSrc = () => readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
import { SHOW_CHAT_TOOL_RAIL } from './chat-entry-flags';

// 收起:只留图标条
assert.equal(chatToolRailReserve(false, 340, 1200), CHAT_TOOL_RAIL_WIDTH);
// 展开:图标条 + 面板,聊天区跟着变窄(停靠,不再浮在气泡上)
assert.equal(chatToolRailReserve(true, 340, 1200), CHAT_TOOL_RAIL_WIDTH + 340);
// 首次 layout 前(宽度未知)按展开留
assert.equal(chatToolRailReserve(true, 340, 0), CHAT_TOOL_RAIL_WIDTH + 340);
// 窗口太窄:不让面板把聊天挤到最小宽度以下
// 放不下 340 先收窄(admin 2026-11-19:1024 宽窗口面板浮起来盖住发送按钮),收到 PANEL_MIN_WIDTH 还放不下才放弃停靠。
assert.equal(chatToolRailReserve(true, 340, CHAT_TOOL_RAIL_WIDTH + 340 + CHAT_MIN_WIDTH_WITH_PANEL - 1), CHAT_TOOL_RAIL_WIDTH + 339);
assert.equal(dockedPanelWidth(340, 1024 - 310), 340 - (340 + 44 + 340 - 714));
assert.equal(chatToolRailReserve(true, 340, CHAT_TOOL_RAIL_WIDTH + PANEL_MIN_WIDTH + CHAT_MIN_WIDTH_WITH_PANEL), CHAT_TOOL_RAIL_WIDTH + PANEL_MIN_WIDTH);
assert.equal(chatToolRailReserve(true, 340, CHAT_TOOL_RAIL_WIDTH + PANEL_MIN_WIDTH + CHAT_MIN_WIDTH_WITH_PANEL - 1), CHAT_TOOL_RAIL_WIDTH);
assert.equal(dockedPanelWidth(340, 0), 340);
assert.equal(chatToolRailReserve(true, 340, CHAT_TOOL_RAIL_WIDTH + 340 + CHAT_MIN_WIDTH_WITH_PANEL), CHAT_TOOL_RAIL_WIDTH + 340);

// 窄聊天区省掉快捷键提示(🎤 / 发送不能被挤出去,CI voice-hold-overlay 1200x850 抓到过)
assert.equal(composerShowsShortcutHint(0), true);
assert.equal(composerShowsShortcutHint(432), false);
assert.equal(composerShowsShortcutHint(COMPOSER_HINT_MIN_WIDTH), true);
assert.match(chatSrc(), /composerShowsShortcutHint\(paneWidth\)/);

// admin 2026-11-18:右侧边栏打开
assert.equal(SHOW_CHAT_TOOL_RAIL, true);

// 聊天页按侧栏宽度留右边距,paneWidth 扣掉侧栏
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
assert.match(chat, /paddingRight: toolRailReserve/);
assert.match(chat, /rootWidth - toolRailReserve/);
assert.match(chat, /state=\{toolRail\} setState=\{setToolRail\}/);

console.log('chat-tool-rail-layout: ok');
