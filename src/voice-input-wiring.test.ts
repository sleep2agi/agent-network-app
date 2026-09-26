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
ck('识别结果经 insertRecognized 进草稿(setDraft),不走 submit', /onInsert: text => setDraft\(d => insertRecognized\(d, text\)\)/.test(chat));
const wrapAt = chat.indexOf('<View style={styles.inputWrap}>');
const mobileRow = chat.slice(wrapAt, chat.indexOf('</View>', wrapAt));
ck('手机:麦克风在输入框包裹层里(输入框右侧)', mobileRow.includes('<VoiceMicButton voice={voice} style={styles.inputMic} />'));
ck('手机:行仍是 ＋ / 输入框 / 发送(没有新增一个独立按钮位)', mobileRow.includes('<TextInput') && !mobileRow.includes('<Pressable'));
ck('手机:有麦克风时输入框右侧留位', /inputWithMic: \{[^}]*paddingRight: 44/.test(chat));
const desktopBar = chat.slice(chat.indexOf('<View style={styles.desktopToolbarRight}>'), chat.indexOf('styles.desktopSend,'));
ck('桌面:麦克风在工具栏、发送左边', desktopBar.includes('<VoiceMicButton voice={voice} size={20} />'));
ck('只在 voice.available 时画麦克风(纯网页不画)', (chat.match(/voice\.available \? <VoiceMicButton/g) ?? []).length === 2);
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
ck('按住期间不让滚动容器抢手势', /onResponderTerminationRequest: \(\) => false/.test(hook));

// ── 🔴 不打日志(音频与密钥) ──
for (const f of ['src/voice-wav.ts', 'src/doubao-asr.ts', 'src/voice-credentials-model.ts', 'src/voice-credentials.ts', 'src/voice-input-model.ts', 'src/useVoiceInput.ts', 'src/useVoiceRecorder.ts', 'src/VoiceInputUI.tsx', 'src/VoiceSettingsSection.tsx']) {
  ck(`${f} 没有 console.*`, !/\bconsole\.(log|info|warn|error|debug)\b/.test(read(f)));
}
ck('Rust 凭据命令不打日志', !/(println|eprintln|log::)[^\n]*voice/i.test(lib));
const section = read('src/VoiceSettingsSection.tsx');
ck('设置页密钥输入框是 secureTextEntry', (section.match(/secureTextEntry/g) ?? []).length === 2);
ck('设置页保存后清空密钥栏(initialForm)', /setForm\(initialForm\(r\.creds\)\)/.test(section));
ck('设置页不把 creds.accessToken / secretKey 渲染出来', !/\{creds\??\.(accessToken|secretKey)\}/.test(section) && !/value=\{creds/.test(section));

console.log(`voice input wiring: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
