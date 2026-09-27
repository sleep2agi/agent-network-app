// ck-style (self-executing; run by scripts/run-tests.mjs). 设置 → 语音输入 → 麦克风(桌面):
//   model   设备列表(默认项 / 未授权空名 / 伪设备 / 选中设备被拔掉回落)、约束、回落错误判定、电平
//   helper  openMicStream 带 deviceId exact;设备没了回落默认;权限拒绝不回落
//   single  全 app 只有 src/mic-device.ts 调 getUserMedia(判据 + 取集各自自检,CLAUDE.md ⑤)
//   model   settings-model:「麦克风」行只在桌面,关键词搜得到
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIC_REMOVED_NOTICE, SYSTEM_DEFAULT_MIC, SYSTEM_DEFAULT_MIC_LABEL, isMissingDeviceError, micConstraints, micListView, rmsLevel, type RawMediaDevice } from './mic-device-model';
import { filterSettings } from './settings-model';

let p = 0, t = 0;
const ck = (name: string, cond: boolean, extra = '') => { t++; if (cond) { p++; console.log(`✅ ${name}`); } else console.log(`❌ ${name}${extra ? ` (${extra})` : ''}`); };

const mic = (deviceId: string, label: string): RawMediaDevice => ({ deviceId, label, kind: 'audioinput', groupId: 'g' });
const granted: RawMediaDevice[] = [
  mic('default', '默认 - MacBook Pro 麦克风'),
  mic('builtin', 'MacBook Pro 麦克风'),
  mic('usb', 'USB 耳机麦克风'),
  { deviceId: 'cam', label: 'FaceTime 摄像头', kind: 'videoinput' },
  { deviceId: 'spk', label: 'MacBook Pro 扬声器', kind: 'audiooutput' },
  mic('communications', '通讯 - USB 耳机麦克风'),
];

// ── model ────────────────────────────────────────────────────────────────────────────────────
{
  const v = micListView(granted, null);
  ck('默认项永远第一个,值为空串', v.options[0].id === SYSTEM_DEFAULT_MIC && v.options[0].label === SYSTEM_DEFAULT_MIC_LABEL && SYSTEM_DEFAULT_MIC === '');
  ck('只列音频输入,去掉 default / communications 伪设备', JSON.stringify(v.options.map(o => o.id)) === JSON.stringify(['', 'builtin', 'usb']), JSON.stringify(v.options));
  ck('已授权:不需要授权按钮', !v.needsPermission);
  ck('没存过 → 选中默认,不算被拔掉', v.selected === '' && !v.selectedRemoved);
}
{
  const v = micListView(granted, 'usb');
  ck('存的设备还在 → 选中它', v.selected === 'usb' && !v.selectedRemoved);
}
{
  const v = micListView(granted.filter(d => d.deviceId !== 'usb'), 'usb');
  ck('选中的设备被拔掉 → 回落默认 + selectedRemoved', v.selected === '' && v.selectedRemoved);
  ck('回落提示文案说清改回了默认', MIC_REMOVED_NOTICE.includes('跟随系统默认'));
}
{
  // Chromium 授权前:label '' 且 deviceId ''
  const v = micListView([mic('', ''), mic('', ''), { deviceId: '', label: '', kind: 'videoinput' }], 'usb');
  ck('空设备名 → needsPermission', v.needsPermission);
  ck('未授权时只有默认项(不列一串「麦克风 1/2」)', v.options.length === 1 && v.options[0].id === '');
  ck('未授权时不判「被拔掉」(列表不可信),选中显示为默认', !v.selectedRemoved && v.selected === '');
}
{
  const v = micListView([], null);
  ck('一个音频输入都没有 → 也先让用户授权', v.needsPermission && v.options.length === 1);
  const w = micListView([mic('a', ''), mic('b', 'USB')], null);
  ck('只要有一项没名字就算未授权(WebKit 部分给名)', w.needsPermission);
}
{
  const v = micListView([mic('x', 'A'), mic('x', 'A 重复')], null);
  ck('同一 deviceId 只列一次', v.options.filter(o => o.id === 'x').length === 1);
}

// constraints
{
  const d = micConstraints('');
  ck('默认:不带 deviceId,保留单声道 / 回声消除 / 降噪', !('deviceId' in d) && d.channelCount === 1 && d.echoCancellation === true && d.noiseSuppression === true);
  ck('null / undefined 同默认', !('deviceId' in micConstraints(null)) && !('deviceId' in micConstraints(undefined)));
  const s = micConstraints('usb');
  ck('选了设备:deviceId: { exact }', JSON.stringify(s.deviceId) === JSON.stringify({ exact: 'usb' }) && s.channelCount === 1);
}
ck('OverconstrainedError / NotFoundError → 回落', isMissingDeviceError({ name: 'OverconstrainedError' }) && isMissingDeviceError({ name: 'NotFoundError' }));
ck('权限拒绝 / 其它错误 / null → 不回落', !isMissingDeviceError({ name: 'NotAllowedError' }) && !isMissingDeviceError(new Error('x')) && !isMissingDeviceError(null));
ck('电平:静音 0,满幅 1,空 0', rmsLevel(new Float32Array(512)) === 0 && rmsLevel(new Float32Array(512).fill(1)) === 1 && rmsLevel([]) === 0);
{
  const speech = rmsLevel(new Float32Array(512).fill(0.05));
  ck('电平:正常说话(RMS 0.05)点亮 20–50%', speech > 0.2 && speech < 0.5, speech.toFixed(3));
}

// ── helper(openMicStream)────────────────────────────────────────────────────────────────────
{
  const calls: MediaStreamConstraints[] = [];
  let failWith: string | null = null;
  const fakeStream = { getTracks: () => [] } as unknown as MediaStream;
  (globalThis as any).navigator = {
    mediaDevices: {
      getUserMedia: async (c: MediaStreamConstraints) => {
        calls.push(c);
        const a = c.audio as MediaTrackConstraints;
        if (failWith && a.deviceId) throw Object.assign(new Error(failWith), { name: failWith });
        return fakeStream;
      },
      enumerateDevices: async () => granted,
    },
  };
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  const { openMicStream, requestMicPermission, listMediaDevices, loadMicDeviceId, saveMicDeviceId } = await import('./mic-device');
  ck('没存过 → 读出默认 \'\'', loadMicDeviceId() === '');
  await openMicStream();
  ck('没存过:录音不带 deviceId', calls.length === 1 && !('deviceId' in (calls[0].audio as any)));
  saveMicDeviceId('usb');
  ck('选择存进本地偏好,读回一致', loadMicDeviceId() === 'usb' && [...store.values()].includes('usb'));
  calls.length = 0;
  await openMicStream();
  ck('不传参(录音路径)= 用存的设备', calls.length === 1 && JSON.stringify((calls[0].audio as any).deviceId) === '{"exact":"usb"}');
  calls.length = 0;
  const r1 = await openMicStream('usb');
  ck('openMicStream(id):一次 getUserMedia,deviceId exact', calls.length === 1 && JSON.stringify((calls[0].audio as any).deviceId) === '{"exact":"usb"}' && !r1.fellBack);
  calls.length = 0; failWith = 'OverconstrainedError';
  const r2 = await openMicStream('usb');
  ck('设备没了(Overconstrained)→ 再开一次默认,fellBack', calls.length === 2 && !('deviceId' in (calls[1].audio as any)) && r2.fellBack);
  calls.length = 0; failWith = 'NotFoundError';
  ck('NotFoundError 同样回落', (await openMicStream('usb')).fellBack && calls.length === 2);
  calls.length = 0; failWith = 'NotAllowedError';
  let threw = '';
  try { await openMicStream('usb'); } catch (e) { threw = (e as Error).name; }
  ck('权限拒绝:不回落,原样抛出', threw === 'NotAllowedError' && calls.length === 1);
  calls.length = 0; failWith = null;
  await requestMicPermission();
  ck('允许访问麦克风:开默认设备', calls.length === 1 && !('deviceId' in (calls[0].audio as any)));
  ck('listMediaDevices 原样返回', (await listMediaDevices()).length === granted.length);
}

// ── single path:只有 mic-device.ts 调 getUserMedia ───────────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const posix = (s: string) => s.split(sep).join('/');
const lf = (s: string) => s.replace(/\r\n?/g, '\n');
const HELPER = 'src/mic-device.ts';

function collect(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const abs = join(dir, e);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (/\.(tsx?|mts|jsx?|mjs)$/.test(e) && !/\.test\.[a-z]+$/.test(e) && !/\.d\.ts$/.test(e)) out.push(abs);
    }
  };
  walk(join(root, 'src'));
  for (const top of ['App.tsx', 'index.ts']) { try { if (statSync(join(root, top)).isFile()) out.push(join(root, top)); } catch { /* absent */ } }
  return out;
}
// 注释里提到 getUserMedia 不算;调用 / 取方法引用(含 ['getUserMedia'] 和 webkitGetUserMedia)都算。
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const USE = /getUserMedia\s*\(|\[\s*['"`]getUserMedia['"`]\s*\]|webkitGetUserMedia|mozGetUserMedia/i;
const offenders = (root: string) => collect(root).map(abs => posix(relative(root, abs))).filter(rel => rel !== HELPER && USE.test(stripComments(lf(readFileSync(join(root, rel), 'utf8')))));

{
  // 判据自检
  ck('判据:.getUserMedia( 算', USE.test(stripComments('await navigator.mediaDevices.getUserMedia({ audio: true });')));
  ck('判据:换行后的调用也算', USE.test(stripComments('navigator.mediaDevices\n  .getUserMedia ({ audio: true })')));
  ck('判据:[\'getUserMedia\'] 取引用算', USE.test(stripComments("const g = md['getUserMedia'];")));
  ck('判据:只在注释里提到不算', !USE.test(stripComments('// getUserMedia(…) 在 mic-device.ts\n/* getUserMedia( */ const x = 1;')));
  ck('判据:CRLF 源文件照样判', USE.test(stripComments(lf('const a = 1;\r\nmd.getUserMedia({audio:true});\r\n'))));
  // 取集自检:子目录 / .tsx / App.tsx 都要收进来;.test.ts 不收;helper 自己豁免
  const tmp = mkdtempSync(join(tmpdir(), 'mic-single-'));
  try {
    const put = (rel: string, body: string) => { mkdirSync(dirname(join(tmp, rel)), { recursive: true }); writeFileSync(join(tmp, rel), body); };
    put('src/mic-device.ts', 'md.getUserMedia({audio:true});');
    put('src/deep/nested/Rec.tsx', 'x.getUserMedia({audio:true});');
    put('src/ok.ts', '// getUserMedia( only mentioned\n');
    put('src/foo.test.ts', 'md.getUserMedia({});');
    put('App.tsx', 'navigator.mediaDevices.getUserMedia({audio:{}});\r\n');
    const got = offenders(tmp).sort();
    ck('取集:子目录 .tsx 与根 App.tsx 被收进来、helper 豁免、测试文件不收', JSON.stringify(got) === JSON.stringify(['App.tsx', 'src/deep/nested/Rec.tsx']), JSON.stringify(got));
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  const files = collect(repo);
  ck('取集:真仓里收到了 helper 和录音 hook', files.some(f => posix(relative(repo, f)) === HELPER) && files.some(f => posix(relative(repo, f)) === 'src/useVoiceRecorder.ts'), String(files.length));
  const bad = offenders(repo);
  ck('全仓只有 src/mic-device.ts 调 getUserMedia', bad.length === 0, bad.join(', '));
  ck('helper 自己确实调了(否则上一条是空转)', USE.test(stripComments(lf(readFileSync(join(repo, HELPER), 'utf8')))));
  ck('录音 hook 走 openMicStream', /openMicStream\(\)/.test(readFileSync(join(repo, 'src/useVoiceRecorder.ts'), 'utf8')));
}

// ── settings-model ────────────────────────────────────────────────────────────────────────────
{
  const rowOn = (platform: 'android' | 'ios' | 'desktop' | 'web') =>
    filterSettings('', { localHub: true }, undefined, platform).find(c => c.key === 'voice')?.rows.some(r => r.key === 'mic') ?? false;
  ck('「麦克风」行:桌面有', rowOn('desktop'));
  ck('「麦克风」行:安卓 / iOS / 网页没有', !rowOn('android') && !rowOn('ios') && !rowOn('web'));
  for (const q of ['麦克风', '输入设备', 'microphone', 'mic', 'device']) {
    const hit = filterSettings(q, { localHub: true }, undefined, 'desktop').find(c => c.key === 'voice')?.rows.some(r => r.key === 'mic') ?? false;
    ck(`搜「${q}」能找到麦克风行`, hit);
  }
}

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
