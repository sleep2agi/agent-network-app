// 设置 → 快捷键:模型 + 存储 + 接线。ck 风格,自执行,失败 exit 1。run: bun src/shortcuts-model.test.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from './shortcuts-model';
import { settingsTranslations } from './i18n-settings';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n, extra); };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n?/g, '\n');

// ── 事件 → 组合 ──
const ev = (o: M.KeyEventLike) => o;
ck('非 mac:Ctrl+K → Mod+K', M.comboFromEvent(ev({ key: 'k', code: 'KeyK', ctrlKey: true }), false) === 'Mod+K');
ck('mac:⌘+K → Mod+K', M.comboFromEvent(ev({ key: 'k', code: 'KeyK', metaKey: true }), true) === 'Mod+K');
ck('mac:⌃+K → Ctrl+K(不是 Mod)', M.comboFromEvent(ev({ key: 'k', code: 'KeyK', ctrlKey: true }), true) === 'Ctrl+K');
ck('mac:⌘,', M.comboFromEvent(ev({ key: ',', code: 'Comma', metaKey: true }), true) === 'Mod+,');
ck('按物理键:mac ⌥+K 的 key 是 ˚ 仍记作 K', M.comboFromEvent(ev({ key: '˚', code: 'KeyK', metaKey: true, altKey: true }), true) === 'Mod+Alt+K');
ck('按物理键:Shift+1 的 key 是 ! 仍记作 1', M.comboFromEvent(ev({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }), false) === 'Mod+Shift+1');
ck('小键盘数字 = 数字', M.comboFromEvent(ev({ key: '3', code: 'Numpad3', ctrlKey: true }), false) === 'Mod+3');
ck('没有 code 退回 key', M.comboFromEvent(ev({ key: 'j', ctrlKey: true }), false) === 'Mod+J');
ck('纯修饰键 → null', M.comboFromEvent(ev({ key: 'Control', code: 'ControlLeft', ctrlKey: true }), false) === null && M.comboFromEvent(ev({ key: 'Meta', code: 'MetaLeft', metaKey: true }), true) === null);
ck('输入法 Process → null', M.comboFromEvent(ev({ key: 'Process' }), false) === null);
ck('Esc 规范化', M.comboFromEvent(ev({ key: 'Esc' }), false) === 'Escape');

// ── 规范化 / 显示 ──
ck('normalizeCombo 修饰键排序 + 大小写', M.normalizeCombo('shift+mod+k') === 'Mod+Shift+K');
ck('normalizeCombo 拒绝未知修饰键 / 重复 / 空', M.normalizeCombo('Hyper+K') === null && M.normalizeCombo('Mod+Mod+K') === null && M.normalizeCombo('') === null && M.normalizeCombo(42) === null && M.normalizeCombo('Mod+') === null);
ck('mac 键帽:⌘ K', JSON.stringify(M.comboChips('Mod+K', true)) === '["⌘","K"]');
ck('非 mac 键帽:Ctrl Shift 1', JSON.stringify(M.comboChips('Mod+Shift+1', false)) === '["Ctrl","Shift","1"]');
ck('mac 键帽:⌘ ⇧ ⌥', JSON.stringify(M.comboChips('Mod+Alt+Shift+K', true)) === '["⌘","⌥","⇧","K"]');
ck('方向键 / Esc 显示成符号', M.comboChips('ArrowLeft', true)[0] === '←' && M.comboChips('Escape', false)[0] === 'Esc');
ck('isMacLike', M.isMacLike('MacIntel') && M.isMacLike('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)') && !M.isMacLike('Win32') && !M.isMacLike('Linux x86_64'));

// ── 默认值 ──
const defs = M.defaultBindings();
ck('默认:⌘K 搜索 / ⌘, 设置 / ⌘1..5 切 tab', defs['nav.search'] === 'Mod+K' && defs['nav.settings'] === 'Mod+,' && defs['nav.tab.agents'] === 'Mod+1' && defs['nav.tab.server'] === 'Mod+5');
ck('默认组合互不重复', new Set(Object.values(defs)).size === M.SHORTCUTS.length);
ck('默认组合都能通过自己的录入校验', M.SHORTCUTS.every(s => M.judgeCapture(s.id, s.defaultCombo, defs, true).ok));
ck('默认组合不碰保留 / 固定', M.SHORTCUTS.every(s => !M.RESERVED_COMBOS[s.defaultCombo] && !M.FIXED_SHORTCUTS.some(f => f.combos.includes(s.defaultCombo))));
ck('每个 id 都有动作', M.SHORTCUTS.every(s => { const a = M.shortcutAction(s.id); return a.kind === 'agentSearch' || a.kind === 'voice' || !!a.screen; }));
ck('动作:⌘K=搜索、⌘,=设置、⌘3=定时', M.shortcutAction('nav.search').kind === 'agentSearch' && JSON.stringify(M.shortcutAction('nav.settings')) === '{"kind":"screen","screen":"settings"}' && JSON.stringify(M.shortcutAction('nav.tab.scheduled')) === '{"kind":"screen","screen":"scheduled"}');

// ── 语音两条(输入组)──
{
  const hold = M.SHORTCUTS.find(s => s.id === 'input.voiceHold');
  const toggle = M.SHORTCUTS.find(s => s.id === 'input.voiceToggle');
  ck('输入组有「按键说话」「语音输入开关」两条可改快捷键', hold?.group === 'input' && hold.label === '按键说话' && toggle?.group === 'input' && toggle.label === '语音输入开关');
  ck('默认:按住说话 = Mod+Shift+Space,开关 = Mod+Shift+M', defs['input.voiceHold'] === 'Mod+Shift+Space' && defs['input.voiceToggle'] === 'Mod+Shift+M');
  ck('按 OS 的默认:Windows / Linux 显示 Ctrl Shift Space · Ctrl Shift M', JSON.stringify(M.comboChips(defs['input.voiceHold'], false)) === '["Ctrl","Shift","Space"]' && JSON.stringify(M.comboChips(defs['input.voiceToggle'], false)) === '["Ctrl","Shift","M"]');
  ck('按 OS 的默认:mac 显示 ⌘ ⇧ Space · ⌘ ⇧ M', JSON.stringify(M.comboChips(defs['input.voiceHold'], true)) === '["⌘","⇧","Space"]' && JSON.stringify(M.comboChips(defs['input.voiceToggle'], true)) === '["⌘","⇧","M"]');
  ck('键盘事件 → 默认组合:Windows Ctrl+Shift+Space / mac ⌘⇧Space 都认成 Mod+Shift+Space',
    M.comboFromEvent({ key: ' ', code: 'Space', ctrlKey: true, shiftKey: true }, false) === 'Mod+Shift+Space'
    && M.comboFromEvent({ key: ' ', code: 'Space', metaKey: true, shiftKey: true }, true) === 'Mod+Shift+Space'
    && M.shortcutForCombo(defs, 'Mod+Shift+Space') === 'input.voiceHold' && M.shortcutForCombo(defs, 'Mod+Shift+M') === 'input.voiceToggle');
  ck('动作:两条都是 voice(hold / toggle)', JSON.stringify(M.shortcutAction('input.voiceHold')) === '{"kind":"voice","mode":"hold"}' && JSON.stringify(M.shortcutAction('input.voiceToggle')) === '{"kind":"voice","mode":"toggle"}');
  // 不选 Ctrl+Space / ⌥Space 的理由写成断言:它们在录入时就会被拒。
  const winCtrlSpace = M.judgeCapture('input.voiceHold', 'Mod+Space', defs, false);
  ck('Windows / Linux:Ctrl+Space 是输入法中 / 英切换,拒绝', !winCtrlSpace.ok && winCtrlSpace.reason === 'reserved' && winCtrlSpace.message.includes('输入法'), JSON.stringify(winCtrlSpace));
  const macCmdSpace = M.judgeCapture('input.voiceHold', 'Mod+Space', defs, true);
  ck('mac:⌘Space 是 Spotlight,拒绝', !macCmdSpace.ok && macCmdSpace.message.includes('Spotlight'));
  const macCtrlSpace = M.judgeCapture('input.voiceHold', 'Ctrl+Space', defs, true);
  ck('mac:⌃Space 是切换输入法,拒绝', !macCtrlSpace.ok && macCtrlSpace.message.includes('输入法'));
  ck('mac:⌥Space(只带 ⌥)按录入规则拒绝', (() => { const v = M.judgeCapture('input.voiceHold', 'Alt+Space', defs, true); return !v.ok && v.reason === 'needsModifier'; })());
  ck('默认组合在两个平台上都不碰系统保留', M.SHORTCUTS.every(s => !M.OS_RESERVED_COMBOS.mac[s.defaultCombo] && !M.OS_RESERVED_COMBOS.other[s.defaultCombo]));
  ck('默认组合在两个平台上都能通过录入校验', M.SHORTCUTS.every(s => M.judgeCapture(s.id, s.defaultCombo, defs, true).ok && M.judgeCapture(s.id, s.defaultCombo, defs, false).ok));
  const clash = M.judgeCapture('nav.search', 'Mod+Shift+Space', defs, false);
  ck('冲突检测:把搜索改成 Ctrl+Shift+Space → 与「按键说话」冲突', !clash.ok && clash.reason === 'conflict' && clash.conflictWith === 'input.voiceHold' && clash.message.includes('按键说话'));
  const clash2 = M.judgeCapture('input.voiceHold', 'Mod+Shift+M', defs, false);
  ck('冲突检测:按住说话改成开关的组合 → 点名「语音输入开关」', !clash2.ok && clash2.conflictWith === 'input.voiceToggle');
  ck('冲突检测:按住说话改成 Ctrl+2 → 与「切换到 任务」冲突', (() => { const v = M.judgeCapture('input.voiceHold', 'Mod+2', defs, false); return !v.ok && v.message.includes('切换到 任务'); })());
  ck('可以改成 F8(F 键不必带修饰)', M.judgeCapture('input.voiceHold', 'F8', defs, false).ok);
  const moved = M.withBinding(M.EMPTY_PREFS, 'input.voiceHold', 'F8');
  ck('改绑 + 恢复默认', M.resolveBindings(moved)['input.voiceHold'] === 'F8' && M.isCustomized(moved, 'input.voiceHold') && !M.isCustomized(M.withBinding(moved, 'input.voiceHold', null), 'input.voiceHold'));
  const stored = M.parseShortcutPrefs(M.serializeShortcutPrefs({ overrides: { 'input.voiceToggle': 'Mod+Alt+V' }, sendKey: 'enter' }));
  ck('语音快捷键的覆盖能存能读', stored.overrides['input.voiceToggle'] === 'Mod+Alt+V');
}

// ── 标签:一律中文,不中英混排(owner 09-27 截图:「切换到 Tasks」「切换到 Messages」)──
{
  const tabLabels = M.SHORTCUTS.filter(s => s.id.startsWith('nav.tab.')).map(s => s.label);
  ck('导航 tab 标签 = 切换到 会话 / 任务 / 定时任务 / 消息 / 服务器', JSON.stringify(tabLabels) === JSON.stringify(['切换到 会话', '切换到 任务', '切换到 定时任务', '切换到 消息', '切换到 服务器']), tabLabels.join(','));
  const english = /[A-Za-z]{2,}/;
  const all = [...M.SHORTCUTS.map(s => s.label), ...M.FIXED_SHORTCUTS.map(f => f.label), ...M.SHORTCUT_GROUPS.map(g => g.label)];
  const bad = all.filter(l => english.test(l));
  ck('快捷键页所有行标签 / 分组名里没有英文单词', bad.length === 0, bad.join(' | '));
  // 页面上写死的文案(发送消息 / 换行 / 随发送键 / 固定 / 页脚)也扫一遍;键帽(Ctrl / Shift / Space / Enter / Esc)是键名,不算。
  const page = read('src/ShortcutsSettings.tsx');
  const texts = [...page.matchAll(/tr\('(settings\.copy\.\d+)'/g)].map(m => settingsTranslations[m[1]]?.[0] ?? 'MISSING');
  const KEY_NAMES = /\b(?:Esc|Ctrl|Shift|Space|Enter|Alt|Tab)\b/g;
  const badText = texts.filter(t => english.test(t.replace(KEY_NAMES, '')));
  ck('快捷键页翻译表的中文文案里没有夹英文', texts.length >= 5 && badText.length === 0, `${texts.length} texts; ${badText.join(' | ')}`);
}

// tab 快捷键和桌面导航栏真实顺序一致(App.tsx DESKTOP_TABS,去掉设置)。
{
  const app = read('App.tsx');
  const block = app.slice(app.indexOf('const DESKTOP_TABS = ['), app.indexOf('] as const;', app.indexOf('const DESKTOP_TABS = [')));
  const railKeys = [...block.matchAll(/key: '([a-z]+)'/g)].map(m => m[1]).filter(k => k !== 'settings');
  const tabShortcuts = M.SHORTCUTS.filter(s => s.id.startsWith('nav.tab.'));
  ck('⌘1..N 与导航栏顺序一一对应', railKeys.length === tabShortcuts.length && tabShortcuts.every((s, i) => M.TAB_FOR_SHORTCUT[s.id] === railKeys[i] && s.defaultCombo === `Mod+${i + 1}`), `${railKeys} vs ${tabShortcuts.map(s => M.TAB_FOR_SHORTCUT[s.id])}`);
}

// ── 录入判定 ──
{
  const j = (id: M.ShortcutId, combo: string, b = defs) => M.judgeCapture(id, combo, b, false);
  ck('不带修饰键拒绝(会在输入框里误触发)', (() => { const v = j('nav.search', 'K'); return !v.ok && v.reason === 'needsModifier'; })());
  ck('只带 Shift 拒绝', !j('nav.search', 'Shift+K').ok);
  ck('只带 Alt 拒绝', !j('nav.search', 'Alt+K').ok);
  ck('F 键可以不带修饰', j('nav.search', 'F2').ok);
  ck('保留组合拒绝(复制)', (() => { const v = j('nav.search', 'Mod+C'); return !v.ok && v.reason === 'reserved' && v.message.includes('复制'); })());
  ck('固定快捷键冲突(规则查找 ⌘F)', (() => { const v = j('nav.search', 'Mod+F'); return !v.ok && v.reason === 'conflict' && v.message.includes('规则文件内查找'); })());
  ck('与另一条冲突,点名是谁', (() => { const v = j('nav.search', 'Mod+,'); return !v.ok && v.reason === 'conflict' && v.conflictWith === 'nav.settings' && v.message.includes('打开设置'); })());
  ck('和自己现在的组合相同不算冲突', j('nav.search', 'Mod+K').ok);
  ck('新组合 OK', (() => { const v = j('nav.search', 'Mod+Shift+P'); return v.ok && v.combo === 'Mod+Shift+P'; })());
  ck('mac 上 ⌃ 也算修饰', M.judgeCapture('nav.search', 'Ctrl+K', defs, true).ok);
}

// ── 存储 ──
{
  const e = M.parseShortcutPrefs(null);
  ck('空存储 = 默认', JSON.stringify(e.overrides) === '{}' && e.sendKey === 'enter');
  ck('坏 JSON = 默认', M.parseShortcutPrefs('{oops').sendKey === 'enter');
  const rt = M.parseShortcutPrefs(M.serializeShortcutPrefs({ overrides: { 'nav.search': 'Mod+P' }, sendKey: 'modEnter' }));
  ck('往返', rt.overrides['nav.search'] === 'Mod+P' && rt.sendKey === 'modEnter');
  const junk = M.parseShortcutPrefs(JSON.stringify({ overrides: { 'nav.search': 'Hyper+P', 'nope': 'Mod+J', 'nav.settings': 'shift+mod+s' }, sendKey: 'weird' }));
  ck('丢掉认不出的 id / 组合,规范化其余', junk.overrides['nav.search'] === undefined && !('nope' in junk.overrides) && junk.overrides['nav.settings'] === 'Mod+Shift+S' && junk.sendKey === 'enter');
  const clash = M.resolveBindings({ overrides: { 'nav.settings': 'Mod+K' }, sendKey: 'enter' });
  ck('存储里撞车:后者退回默认,一个组合不对两个动作', clash['nav.search'] === 'Mod+K' && clash['nav.settings'] === 'Mod+,');
  const set = M.withBinding(M.EMPTY_PREFS, 'nav.search', 'Mod+P');
  ck('withBinding 设新值', set.overrides['nav.search'] === 'Mod+P' && M.isCustomized(set, 'nav.search') && M.anyCustomized(set));
  ck('withBinding 设回默认 = 不存覆盖', !M.isCustomized(M.withBinding(set, 'nav.search', 'Mod+K'), 'nav.search'));
  ck('withBinding null = 恢复默认', JSON.stringify(M.withBinding(set, 'nav.search', null).overrides) === '{}');
  ck('withBinding 不改原对象', M.EMPTY_PREFS.overrides['nav.search'] === undefined);
  ck('只改发送键也算「改过」', M.anyCustomized({ overrides: {}, sendKey: 'modEnter' }));
  ck('发送 / 换行组合', M.sendCombo('enter') === 'Enter' && M.newlineCombo('enter') === 'Shift+Enter' && M.sendCombo('modEnter') === 'Mod+Enter' && M.newlineCombo('modEnter') === 'Enter');
  ck('shortcutForCombo', M.shortcutForCombo(defs, 'Mod+2') === 'nav.tab.tasks' && M.shortcutForCombo(defs, 'Mod+9') === null && M.shortcutForCombo(defs, null) === null);
}

// ── store(localStorage 替身)──
{
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
  const S = await import('./shortcuts-store');
  S.__reloadShortcutPrefs();
  ck('store:默认绑定', S.shortcutBindings()['nav.search'] === 'Mod+K' && S.sendKeyPref() === 'enter');
  ck('store:快照稳定(同一对象)', S.shortcutPrefs() === S.shortcutPrefs() && S.shortcutBindings() === S.shortcutBindings());
  let fired = 0;
  const off = S.subscribeShortcuts(() => { fired++; });
  S.saveShortcutPrefs(M.withBinding({ ...S.shortcutPrefs(), sendKey: 'modEnter' }, 'nav.search', 'Mod+P'));
  ck('store:保存通知订阅者并落盘', fired === 1 && (mem.get(S.SHORTCUTS_KEY) ?? '').includes('Mod+P'));
  ck('store:保存后绑定与发送键更新', S.shortcutBindings()['nav.search'] === 'Mod+P' && S.sendKeyPref() === 'modEnter');
  S.__reloadShortcutPrefs();
  ck('store:重开后从存储读回', S.shortcutBindings()['nav.search'] === 'Mod+P' && S.sendKeyPref() === 'modEnter');
  off();
  ck('store:录入中信号', (S.setShortcutCaptureActive(true), S.shortcutCaptureActive()) && (S.setShortcutCaptureActive(false), !S.shortcutCaptureActive()));
  ck('store:搜索聚焦请求只被取一次', (S.requestAgentSearchFocus(), S.consumeAgentSearchFocus()) && !S.consumeAgentSearchFocus());
  (globalThis as any).localStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  S.__reloadShortcutPrefs();
  let ok = true;
  try { S.shortcutBindings(); S.saveShortcutPrefs(M.EMPTY_PREFS); } catch { ok = false; }
  ck('store:存储抛错也不崩(只在本次有效)', ok && S.shortcutBindings()['nav.search'] === 'Mod+K');
  delete (globalThis as any).localStorage;
}

// ── 接线(源码层;真按键在 tests/test-shortcuts-settings/drive.mjs 里按)──
{
  const app = read('App.tsx');
  const ws = app.slice(app.indexOf('function DesktopWorkspace('));
  ck('DesktopWorkspace 在捕获阶段挂全局 keydown(RN-web TextInput 会 stopPropagation)并按存储里的绑定执行', ws.includes("doc.addEventListener('keydown', onKey, true)") && ws.includes('shortcutForCombo(shortcutBindings(), comboFromEvent(event, mac))'));
  ck('录入中 / 输入法组词中不执行', ws.includes('shortcutCaptureActive()') && ws.includes('event.isComposing'));
  ck('语音快捷键落到 DesktopWorkspace = 没有会话 → 提示「先打开一个会话」(按住不放不重复提示)', ws.includes("action.kind === 'voice'") && ws.includes('if (!event.repeat) setShortcutToast(NEED_COMPOSER_NOTICE)') && ws.includes('<ShortcutToast text={shortcutToast} />'));
  const chat = read('src/ChatScreen.tsx');
  ck('ChatScreen:语音快捷键在 window 捕获阶段(先于 DesktopWorkspace 的 document 捕获)接 keydown / keyup,失焦 / 隐藏也喂进去',
    chat.includes("win.addEventListener('keydown', onKeyDown, true)") && chat.includes("win.addEventListener('keyup', onKeyUp, true)") && chat.includes("win.addEventListener('blur', onBlur)") && chat.includes("addEventListener?.('visibilitychange', onVisibility)"));
  ck('ChatScreen:按下 / 松开 / 取消 = 录音条的 开始(点 🎤)/ 完成 / 取消(同一条插到光标处的路)',
    chat.includes('kbdVoiceRef.current = { voice, start: desktopMicClick, done: desktopVoiceDone, cancel: desktopVoiceCancel };') && /effect === 'release'\) done\(\);\s*else if \(r\.effect === 'cancel'\) cancel\(\);/.test(chat));
  ck('ChatScreen:录音中 / 输入法组词中 / 设置页录入中不处理', chat.includes('if (e.isComposing || shortcutCaptureActive()) return;'));
  ck('ChatScreen:快捷键录音用输入框里的同一条录音条,提示换成翻译的快捷键说法', chat.includes('<DesktopVoiceBar voice={voice} onDone={desktopVoiceDone} onCancel={desktopVoiceCancel} hint={kbdVoice ? t(') && chat.includes("'voice.releaseKeys' : 'voice.pressKeys'") && !chat.includes('VoiceShortcutIndicator'));
  const page = read('src/ShortcutsSettings.tsx');
  ck('设置页:输入组渲染语音两条可改行(与导航同一个 BindableRow:录入 / 冲突提示 / 恢复默认)', page.includes("SHORTCUTS.filter(d => d.group === 'input').map(d => <BindableRow") && page.includes("SHORTCUTS.filter(d => d.group === 'nav').map((d, i) => <BindableRow"));
  const agents = read('src/AgentsScreen.tsx');
  ck('Agents 列表接 ⌘K:露出并聚焦搜索框', agents.includes('subscribeAgentSearchFocus(take)') && agents.includes('sessions.length > 10 || searchOpen || query') && agents.includes('ref={searchRef}'));
  const settings = read('src/SettingsScreen.tsx');
  ck('设置页渲染快捷键分区', settings.includes("sectionsToRender.includes('shortcuts')") && settings.includes('<ShortcutsSettings'));
  const model = read('src/settings-model.ts');
  const iShortcuts = model.indexOf("key: 'shortcuts'"), iAbout = model.indexOf("key: 'about'");
  ck('左栏:快捷键在「关于」上面', iShortcuts > 0 && iShortcuts < iAbout);
}
{
  const { filterSettings } = await import('./settings-model');
  const on = (pf: 'desktop' | 'web' | 'android' | 'ios') => filterSettings('', {}, undefined, pf).some(c => c.key === 'shortcuts');
  ck('只在桌面端出现(手机 / 网页版的手机布局不出现)', on('desktop') && !on('android') && !on('ios') && !on('web'));
  ck('搜「快捷键」「发送」能搜到', filterSettings('快捷键', {}, undefined, 'desktop').some(c => c.key === 'shortcuts') && filterSettings('换行', {}, undefined, 'desktop').some(c => c.key === 'shortcuts'));
}

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
