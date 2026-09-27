// 桌面语音录音条(desktop-voice-bar-model.ts + DesktopVoiceBar.tsx + ChatScreen 接线)。ck 风格,自执行,失败 exit 1。
// run: bun src/desktop-voice-bar.test.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as B from './desktop-voice-bar-model';
import type { VoicePhase } from './voice-input-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n, extra); };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n?/g, '\n');

// ── 平台判定 ──
ck('桌面 = 输入框里的录音条;其它 = 手机浮层', B.voiceSurface(true) === 'inlineBar' && B.voiceSurface(false) === 'phoneOverlay');

// ── 显示 / 点击 ──
const phases: VoicePhase[] = ['idle', 'starting', 'recording', 'cancelArmed', 'transcribing'];
ck('录音条:这一句没结束就一直在(准备 / 录音 / 识别中),空闲时换回工具栏', phases.every(ph => B.showVoiceBar(ph) === (ph !== 'idle')));
ck('点 🎤:空闲 → 开始', B.micClickAction('idle') === 'start');
ck('点 🎤:录音中 → 完成(切换)', B.micClickAction('recording') === 'done' && B.micClickAction('starting') === 'done');
ck('点 🎤:识别中 → 不理', B.micClickAction('transcribing') === null);

// ── 按键 ──
ck('录音中 Enter = 完成', B.barKeyAction('recording', { key: 'Enter' }) === 'done');
ck('录音中 Esc = 取消', B.barKeyAction('recording', { key: 'Escape' }) === 'cancel' && B.barKeyAction('recording', { key: 'Esc' }) === 'cancel');
ck('录音中 Shift / Ctrl / ⌘+Enter 吃掉(不换行、不发送)', ['shiftKey', 'ctrlKey', 'metaKey'].every(m => B.barKeyAction('recording', { key: 'Enter', [m]: true }) === 'swallow'));
ck('识别中 Enter 吃掉(不能在文字插进来之前把草稿发出去)', B.barKeyAction('transcribing', { key: 'Enter' }) === 'swallow');
ck('识别中 Esc 吃掉(识别不能中途取消,也别关掉别的东西)', B.barKeyAction('transcribing', { key: 'Escape' }) === 'swallow');
ck('空闲时 Enter / Esc 不归录音条', B.barKeyAction('idle', { key: 'Enter' }) === null && B.barKeyAction('idle', { key: 'Escape' }) === null);
ck('输入法组词中不管', B.barKeyAction('recording', { key: 'Enter', isComposing: true }) === null);
ck('其它键(打字)不管', B.barKeyAction('recording', { key: 'a' }) === null);

// ── 文案:没有手机手势 ──
const texts = [...phases.map(B.barHint), B.desktopVoiceNotice('说话时间太短')];
ck('录音条提示 / 桌面提示里没有「上滑」「松开」「按住」', texts.every(s => !/上滑|松开|按住/.test(s)), texts.join(' | '));
ck('「说话时间太短」桌面上换成「录音太短」', B.desktopVoiceNotice('说话时间太短') === '录音太短,没有识别');
ck('其它提示原样', B.desktopVoiceNotice('已取消') === '已取消' && B.desktopVoiceNotice('没有识别到文字') === '没有识别到文字');
ck('录音中的提示:Enter 完成 · Esc 取消', B.barHint('recording') === '正在录音 · Enter 完成 · Esc 取消' && B.barHint('transcribing') === '识别中…');

// ── 接线:桌面上永远不挂手机浮层 ──
{
  const chat = read('src/ChatScreen.tsx');
  const overlayMounts = chat.match(/<VoiceRecordingOverlay\b[^\n]*/g) ?? [];
  ck('手机浮层只挂一处,且挂在 voiceSurface(desktop) === \'phoneOverlay\' 下', overlayMounts.length === 1 && /\{voiceSurface\(desktop\) === 'phoneOverlay' \? <VoiceRecordingOverlay\b/.test(chat), overlayMounts.join(' | '));
  ck('浮层不再用桌面的 composerHeight 算位置(桌面不挂)', !chat.includes('composerHeight + 24'));
  ck('桌面:录音中工具栏整行换成录音条', /voiceSurface\(desktop\) === 'inlineBar' && showVoiceBar\(voice\.state\.phase\) \? \(\s*<DesktopVoiceBar voice=\{voice\} onDone=\{desktopVoiceDone\} onCancel=\{desktopVoiceCancel\} \/>\s*\) : \(\s*<View style=\{styles\.desktopToolbar\}>/.test(chat));
  const desktopComposer = chat.slice(chat.indexOf('<View style={[styles.desktopComposer'), chat.indexOf('styles.desktopSendText'));
  ck('录音条挂在桌面输入框的盒子里(desktopComposer 内)', desktopComposer.includes('<DesktopVoiceBar'));
  ck('🎤 点击:开始走麦克风同一套处理(冻结光标处选区)、完成 / 取消走 release / terminate',
    chat.includes("voiceHandlersFor('desktopMic').onResponderGrant(DESKTOP_CLICK_EVENT as unknown as GestureResponderEvent)") && chat.includes('voice.micHandlers.onResponderRelease(DESKTOP_CLICK_EVENT as unknown as GestureResponderEvent)') && chat.includes('voice.micHandlers.onResponderTerminate()'));
  ck('桌面上提示经 desktopVoiceNotice 换说法', chat.includes('{desktop ? desktopVoiceNotice(composerNotice) : composerNotice}'));
  ck('手机分支不受影响:大条仍是按住说话', chat.includes("<VoiceHoldBar voice={voice} handlers={voiceHandlersFor('holdBar')} />"));
  const bar = read('src/DesktopVoiceBar.tsx');
  ck('录音条:红点 / 电平 / 计时 / 取消 / 完成 都在;Enter / Esc 在 window 捕获阶段', ['voice-bar-dot', 'voice-bar-level', 'voice-bar-elapsed', 'voice-bar-cancel', 'voice-bar-done'].every(id => bar.includes(`testID="${id}"`)) && bar.includes("win.addEventListener('keydown', onKey, true)"));
  ck('录音条没有遮罩、没有手势提示', !/rgba\(0,\s*0,\s*0/.test(bar) && !/上滑|松开/.test(bar));
  ck('桌面 🎤 与录音条按钮不抢输入框焦点(mousedown preventDefault)', (bar.match(/\{\.\.\.keepInputFocus\}/g) ?? []).length === 3);
}

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
