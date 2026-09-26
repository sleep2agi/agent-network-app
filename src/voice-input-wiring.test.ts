// ck-style (self-executing; run by scripts/run-tests.mjs). 语音输入的接线契约:
// 聊天页麦克风、「去设置」路由、设置分类、原生权限(安卓/iOS/macOS)、桌面钥匙串命令、
// 以及「不打日志」—— 这些只在真机上才会露馅,在源码层先钉住。
import { readFileSync } from 'node:fs';
import { filterSettings, SETTINGS_CATEGORIES } from './settings-model';

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => { t++; if (cond) { p++; console.log(`✅ ${name}`); } else console.log(`❌ ${name}`); };
const read = (f: string) => readFileSync(f, 'utf8');

const chat = read('src/ChatScreen.tsx');
const app = read('App.tsx');
const settings = read('src/SettingsScreen.tsx');
const hook = read('src/useVoiceInput.ts');
const recorder = read('src/useVoiceRecorder.ts');
const store = read('src/voice-credentials.ts');
const lib = read('src-tauri/src/lib.rs');

// ── 聊天页 ──
ck('ChatScreen 用 useVoiceInput', chat.includes("import { useVoiceInput } from './useVoiceInput'") && /const voice = useVoiceInput\(/.test(chat));
ck('识别结果经 insertRecognized 进草稿(setDraft),不走 submit', /onInsert: text => \{\s*setDraft\(d => insertRecognized\(d, text\)\);/.test(chat) && !/onInsert:[^}]*submit/.test(chat));
ck('识别完(手机)切回键盘并聚焦输入框,不写回偏好', /if \(!desktop\) \{ focusAfterInsertRef\.current = true; setInputMode\('keyboard'\); \}/.test(chat) && chat.includes('mainComposerRef.current?.focus()'));
const rowAt = chat.indexOf('<View style={[styles.inputRow,');
const mobileRow = chat.slice(rowAt, chat.indexOf('{plusMenuOpen ? (', rowAt));
const toggleAt = mobileRow.indexOf('<ComposerModeToggle');
const plusAt = mobileRow.indexOf("plusEvent('toggle')");
ck('手机:切换按钮在输入行最左边(＋ 之前)', toggleAt > 0 && plusAt > toggleAt);
ck('手机:切换按钮只在 voice.available 时画', /\{voice\.available \? <ComposerModeToggle mode=\{inputMode\} onToggle=\{toggleInputMode\} disabled=\{voiceBusy\} \/> : null\}/.test(mobileRow));
ck('手机:语音模式 = 整条「按住 说话」代替输入框', /\{voiceMode \? <VoiceHoldBar voice=\{voice\} \/> : \(\s*<TextInput/.test(mobileRow));
// 微信式(composer-row-layout.ts):右侧一格在语音模式下显示 ＋,不是发送键 —— 判定本身在 composer-row-layout.test.ts。
ck('手机:语音模式下右侧不是发送键(右格判定带 voiceMode)', chat.includes('composerRightSlot({ draft, attachmentCount: attached.length, voiceMode })') && mobileRow.includes('slot={rightSlot}'));
ck('手机:输入框里不再有灰色小麦克风', !mobileRow.includes('<VoiceMicButton') && !chat.includes('inputWithMic') && !chat.includes('styles.inputMic'));
ck('voiceMode 只在非桌面 + available + 用户选了语音时成立', chat.includes("const voiceMode = !desktop && voice.available && inputMode === 'voice';"));
ck('切换写入每设备偏好;启动时读回', chat.includes('void saveComposerInputMode(next);') && chat.includes('void loadComposerInputMode().then(setInputMode)'));
ck('切到语音:收 ＋ 面板、收键盘', /if \(next === 'voice'\) \{\s*if \(plusOpenRef\.current\) plusEvent\('toggle'\);[\s\S]{0,120}Keyboard\.dismiss\(\);/.test(chat));
const desktopBar = chat.slice(chat.indexOf('<View style={styles.desktopToolbarRight}>'), chat.indexOf('styles.desktopSend,'));
ck('桌面:麦克风仍在工具栏、发送左边', desktopBar.includes('<VoiceMicButton voice={voice} size={20} />'));
ck('桌面:麦克风只在 voice.available 时画', (chat.match(/voice\.available \? <VoiceMicButton/g) ?? []).length === 1);
ck('录音浮层 + 「去设置」提示条都挂上了', chat.includes('<VoiceRecordingOverlay voice={voice}') && chat.includes('<VoiceSettingsPrompt voice={voice} onOpenSettings={onOpenVoiceSettings} />'));
ck('提示走现有 composerNotice', chat.includes('onNotice: setComposerNotice'));

// ── 「去设置」路由 ──
const routes = app.match(/onOpenVoiceSettings=\{\(\) => \{ rememberSettingsCategory\('voice'\); setScreen\(\{ name: 'settings' \}\); \}\}/g) ?? [];
ck('App.tsx 三处聊天(手机单栏/双栏/桌面)都传 onOpenVoiceSettings → 设置·语音输入', routes.length === 3);
const detached = app.slice(app.indexOf('testID="dedicated-chat-window"'), app.indexOf('<DesktopMessageListener cfg={cfg} />'));
ck('独立聊天窗口不传(那里没有设置页,提示条改为说明位置)', !detached.includes('onOpenVoiceSettings'));

// ── 设置分类 ──
const voiceCat = SETTINGS_CATEGORIES.find(c => c.key === 'voice');
ck('设置里有「语音输入」分类', voiceCat?.label === '语音输入');
ck('搜「豆包」「语音」「asr」都能找到', ['豆包', '语音', 'asr', 'access token'].every(q => filterSettings(q, {}).some(c => c.key === 'voice')));
ck('手机/桌面有,纯网页没有(没有安全存储)', ['android', 'ios', 'desktop'].every(pf => filterSettings('', {}, undefined, pf as any).some(c => c.key === 'voice')) && !filterSettings('', {}, undefined, 'web').some(c => c.key === 'voice'));
ck('SettingsScreen 渲染 VoiceSettingsSection', settings.includes("sectionsToRender.includes('voice')") && settings.includes('<VoiceSettingsSection'));

// ── 原生权限 ──
const appJson = JSON.parse(read('app.json'));
const audioPlugin = (appJson.expo.plugins as unknown[]).find(pl => Array.isArray(pl) && pl[0] === 'expo-audio') as [string, Record<string, unknown>] | undefined;
ck('app.json 注册 expo-audio 插件(→ RECORD_AUDIO / NSMicrophoneUsageDescription)', !!audioPlugin && audioPlugin[1].recordAudioAndroid === true && typeof audioPlugin[1].microphonePermission === 'string');
ck('不开后台录音/后台播放(不引入前台服务权限)', audioPlugin?.[1].enableBackgroundRecording === false && audioPlugin?.[1].enableBackgroundPlayback === false);
const pkg = JSON.parse(read('package.json'));
ck('expo-audio 钉在 SDK 56(~56.x)', /^~56\./.test(pkg.dependencies['expo-audio'] ?? ''));
ck('macOS Info.plist 有麦克风用途说明', read('src-tauri/Info.plist').includes('<key>NSMicrophoneUsageDescription</key>'));
ck('macOS hardened runtime 有 audio-input entitlement', read('src-tauri/Entitlements.plist').includes('<key>com.apple.security.device.audio-input</key>'));
const tauriConf = JSON.parse(read('src-tauri/tauri.conf.json'));
ck('tauri.conf.json 引用 Entitlements.plist', tauriConf.bundle.macOS.entitlements === './Entitlements.plist');

// ── 桌面钥匙串命令:前端 invoke 名 == Rust 注册名 ──
for (const cmd of ['save_voice_credentials', 'load_voice_credentials', 'clear_voice_credentials']) {
  ck(`${cmd}:前端调用、Rust 定义、generate_handler 注册三处一致`, store.includes(`'${cmd}'`) && lib.includes(`fn ${cmd}(`) && new RegExp(`generate_handler!\\[[\\s\\S]*\\b${cmd},`).test(lib));
}
ck('桌面凭据走 keyring(与登录 token 同 service)', /keyring::Entry::new\(SESSION_SERVICE, VOICE_CREDENTIALS_ACCOUNT\)/.test(lib));
ck('手机凭据走 SecureStore', /SecureStore\.setItemAsync\(KEY, json\)/.test(store));
ck('纯网页不退回 localStorage 存密钥', !/localStorage\s*[.[]/.test(store));

// ── 录音:两条路 ──
ck('手机:expo-audio AudioStream 16 kHz int16', /useAudioStream\(\{\s*sampleRate: TARGET_SAMPLE_RATE,\s*channels: 1,\s*encoding: 'int16'/.test(recorder));
ck('桌面/网页:getUserMedia + Web Audio', recorder.includes('navigator.mediaDevices.getUserMedia') && recorder.includes('createScriptProcessor'));
ck('首次授权弹框打断手势 → 让用户再按一次', recorder.includes('permissionJustGranted: true'));
ck('录音计时器只依赖 recording(电平刷新不会把它一直重建成永不触发)', /dispatchRef\.current\(\{ type: 'tick', now: t \}\); \}, 200\);\s*return \(\) => clearInterval\(id\);\s*\}, \[recording\]\);/.test(hook));
ck('按住期间不让滚动容器抢手势', /onResponderTerminationRequest: \(\) => false/.test(hook));

// ── 🔴 不打日志(音频与密钥) ──
for (const f of ['src/doubao-stream-protocol.ts', 'src/doubao-stream.ts', 'src/voice-stream-policy.ts', 'src/voice-utterance.ts', 'src/voice-prefs.ts', 'src/voice-wav.ts', 'src/doubao-asr.ts', 'src/voice-credentials-model.ts', 'src/voice-credentials.ts', 'src/voice-input-model.ts', 'src/useVoiceInput.ts', 'src/useVoiceRecorder.ts', 'src/VoiceInputUI.tsx', 'src/VoiceSettingsSection.tsx']) {
  ck(`${f} 没有 console.*`, !/\bconsole\.(log|info|warn|error|debug)\b/.test(read(f)));
}
ck('Rust 凭据命令不打日志', !/(println|eprintln|log::)[^\n]*voice/i.test(lib));
const section = read('src/VoiceSettingsSection.tsx');
ck('设置页密钥输入框(API Key、旧版 Access Token)都是 secureTextEntry', (section.match(/secureTextEntry/g) ?? []).length === 2);
ck('设置页保存后清空密钥栏(initialForm)', /setForm\(initialForm\(r\.creds\)\)/.test(section));
ck('设置页不把 creds.accessToken / secretKey 渲染出来', !/\{creds\??\.(accessToken|secretKey)\}/.test(section) && !/value=\{creds/.test(section));

// ── 流式识别 + 设置页(识别模型 / API Key / 高级·旧版控制台)──
{
  const settingsModel = read('src/settings-model.ts');
  ck('设置分类里有「识别模型」一行(手机 + 桌面)', /\{ key: 'mode', label: '识别模型'[^}]*platforms: \['android', 'ios', 'desktop'\] \}/.test(settingsModel));
  ck('搜「流式」「极速版」「边说边出字」能找到语音输入', ['流式', '极速版', '边说边出字', 'api key'].every(q => filterSettings(q, {}).some(c => c.key === 'voice')));
  ck('SettingsScreen 把 mode 行接到 showMode', settings.includes("showMode={show('voice', 'mode')}"));
  ck('识别模型两项的文案', section.includes('MODE_LABELS[m]') && read('src/voice-stream-policy.ts').includes("stream: '流式语音识别（边说边出字）'") && read('src/voice-stream-policy.ts').includes("flash: '录音文件识别·极速版（整段识别）'"));
  const advAt = section.indexOf("{advanced ? (");
  const apiKeyAt = section.indexOf('testID="voice-api-key"');
  const appIdAt = section.indexOf('testID="voice-app-id"');
  const tokenAt = section.indexOf('testID="voice-access-token"');
  ck('默认只有一个 API Key 栏(在「高级」之前)', apiKeyAt > 0 && apiKeyAt < advAt);
  ck('App ID / Access Token 只在「高级 / 旧版控制台」里', appIdAt > advAt && tokenAt > advAt && section.includes("'高级 / 旧版控制台 ›'"));
    const sectionCode = section.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'); // 去掉整行注释(注释里说明了为什么去掉)
  ck('界面上不再有 Secret Key', !/Secret Key|secretKey/.test(sectionCode));
  ck('一行帮助:控制台链接 + 开通管理提示', section.includes('Linking.openURL(VOLC_CONSOLE_URL)') && read('src/voice-credentials-model.ts').includes("VOLC_CONSOLE_URL = 'https://console.volcengine.com/speech/app'") && section.includes("'在『开通管理』里开通：录音文件识别大模型-极速版 +（可选）流式语音识别大模型'"));
  ck('保存新凭据后清掉「流式不可用」记忆', /await saveVoiceCredentials\(r\.creds\);\s*clearStreamUnavailable\(\);/.test(section));
  ck('「测试」按所选识别模型走,流式时实时显示中间结果', section.includes("const route: VoiceMode = mode === 'stream' && streamingSupported(platform) ? 'stream' : 'flash';") && section.includes('newUtterance(route, setInterim)') && section.includes('testID="voice-test-interim"'));
  ck('「测试」回退时说明流式为什么失败', section.includes('note: testFallbackNote(route, r,'));
  ck('「流式未开通，已使用极速版」提示挂在设置里', section.includes('testID="voice-stream-unavailable"') && section.includes('{STREAM_UNAVAILABLE_HINT}'));
  ck('测试报错按控制台版本点名字段(传 credMode)', section.includes('asrErrorMessage(err.code, err.upstream, credMode)'));
}
{
  ck('RN WebSocket 第三个参数带请求头(new WS(url, null, { headers }))', /return new WS\(url, null, \{ headers \}\) as WsLike;/.test(hook));
  ck('流式只在安卓 / iOS(chooseRoute 按 voicePlatform)', hook.includes('chooseRoute({ mode, platform: voicePlatform(), streamUnavailable: !!streamUnavailable() })') && read('src/voice-stream-policy.ts').includes("return platform === 'android' || platform === 'ios';"));
  ck('按下就建连(u.start()),录音分段推给会话', /u\.start\(\);[^\n]*\n\s*recorder\.setChunkListener\(u\.route === 'stream' \? u\.onChunk : null\);/.test(hook));
  ck('取消 / 松手都会摘掉分段回调', (hook.match(/recorder\.setChunkListener\(null\)/g) ?? []).length >= 3);
  ck('录音两条路(原生 onBuffer / Web Audio)都把分段交给 emitChunk', (recorder.match(/\bemitChunk\(/g) ?? []).length === 2);
  ck('录音浮层画中间结果', read('src/VoiceInputUI.tsx').includes('testID="voice-interim"'));
  ck('流式被记住不可用时,聊天页提示一次', hook.includes('if (r.rememberedNow) optsRef.current.onNotice(STREAM_UNAVAILABLE_HINT);'));
  ck('按下 / 进取消区有触感(只在原生)', /hapticFor\(stateRef\.current\.phase, next\.phase\)/.test(hook) && hook.includes("(Platform.OS === 'android' || Platform.OS === 'ios')"));
  ck('expo-haptics 钉在 SDK 56(~56.x)', /^~56\./.test(pkg.dependencies['expo-haptics'] ?? ''));
}

console.log(`voice input wiring: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
