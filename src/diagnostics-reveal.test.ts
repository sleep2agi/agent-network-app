// @ts-nocheck -- repository test scripts run directly under Bun; the app
// tsconfig intentionally excludes Node ambient types.
// 看板 #695 —— 「连接复用」从 设置 → 关于 拿掉,连点「版本」5 下才在「诊断」组里出现;以前关掉的人保持关。
import { readFileSync } from 'node:fs';
import { DIAGNOSTICS_TAPS, DIAGNOSTICS_TAP_GAP_MS, showPooledHttpDiagnostics, tapVersion, VERSION_TAPS_INITIAL } from './diagnostics-reveal';
import { pooledHttpEnabled, setPooledHttpEnabled, POOLED_HTTP_OFF_KEY } from './app-fetch';
import { filterSettings, SETTINGS_CATEGORIES } from './settings-model';
import { settingsTranslations } from './i18n-settings';

let passed = 0;
let total = 0;
const ck = (name: string, condition: boolean) => {
  total++;
  if (condition) { passed++; console.log('✅', name); }
  else console.log('❌', name);
};

const tapN = (n: number, start = 1_000, gap = 300) => {
  let s = VERSION_TAPS_INITIAL;
  for (let i = 0; i < n; i++) s = tapVersion(s, start + i * gap);
  return s;
};

// ── 揭开 ────────────────────────────────────────────────────────────────────────────────
ck('hidden by default', VERSION_TAPS_INITIAL.revealed === false);
ck('5 is the agreed tap count', DIAGNOSTICS_TAPS === 5);
ck('4 quick taps do not reveal', tapN(4).revealed === false && tapN(4).count === 4);
ck('the 5th quick tap reveals', tapN(5).revealed === true);
ck('once revealed, more taps keep it revealed', tapVersion(tapN(5), 999_999).revealed === true);
{
  let s = tapN(4);
  s = tapVersion(s, s.lastAt + DIAGNOSTICS_TAP_GAP_MS + 1);
  ck('a long pause restarts the count (stray taps never add up)', s.revealed === false && s.count === 1);
}
ck('revealed + desktop shell → the 连接复用 switch shows', showPooledHttpDiagnostics(true, 'desktop'));
ck('not revealed → hidden on desktop', !showPooledHttpDiagnostics(false, 'desktop'));
ck('phone / web have no pooled transport → nothing to show even when revealed', !showPooledHttpDiagnostics(true, 'android') && !showPooledHttpDiagnostics(true, 'ios') && !showPooledHttpDiagnostics(true, 'web'));

// ── 关于页不再有这一行、搜不到 ───────────────────────────────────────────────────────────────
ck('关于 has no 连接复用 row', SETTINGS_CATEGORIES.find(c => c.key === 'about')!.rows.every(r => r.key !== 'pooledHttp'));
ck('searching 连接复用 on desktop finds no row', filterSettings('连接复用', { localHub: true, users: true }, undefined, 'desktop').every(c => c.rows.every(r => r.key !== 'pooledHttp')));
ck('诊断 copy exists with an English column', Object.values(settingsTranslations).some(p => p[0] === '诊断' && p[1] === 'Diagnostics'));

// ── 存储:默认开;以前关过的保持关(换入口不碰存储) ─────────────────────────────────────────────
{
  const g = globalThis as any;
  const had = 'localStorage' in g;
  const orig = g.localStorage;
  const store = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
  try {
    ck('fresh install: connection reuse is ON', pooledHttpEnabled() === true);
    store.set(POOLED_HTTP_OFF_KEY, '1'); // a user who turned it off in an older version
    ck('previously-off user: still OFF after the row moved (stored value untouched)', pooledHttpEnabled() === false && store.get(POOLED_HTTP_OFF_KEY) === '1');
    setPooledHttpEnabled(true);
    ck('the diagnostics switch turns it back on via the same key', pooledHttpEnabled() === true && !store.has(POOLED_HTTP_OFF_KEY));
  } finally {
    if (had) g.localStorage = orig; else delete g.localStorage;
  }
}
const src = ['./diagnostics-reveal.ts', './SettingsScreen.tsx', './SettingsPhonePages.tsx', './settings-model.ts'].map(f => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
ck('nothing in the move writes / clears the stored flag on its own (no migration that would reset it)', !/removeItem\(POOLED_HTTP_OFF_KEY\)|setPooledHttpEnabled\(true\)/.test(src));

// ── 接线:两种布局都能连点版本行揭开 ────────────────────────────────────────────────────────────
const wide = readFileSync(new URL('./SettingsScreen.tsx', import.meta.url), 'utf8');
const phone = readFileSync(new URL('./SettingsPhonePages.tsx', import.meta.url), 'utf8');
ck('desktop/wide: version row is tappable', /settings\.copy\.77'\)} value=\{`v\$\{APP_VERSION\}`\} onPress=\{onVersionTap\}/.test(wide));
ck('desktop/wide: 诊断 group gated by the reveal', /showPooledHttpDiagnostics\(versionTaps\.revealed, platform\)[^\n]*\?[\s\S]{0,120}settings-diagnostics-group/.test(wide));
ck('phone pages: version row is tappable', /settings-version-row[^\n]*onPress=\{ctx\.onVersionTap\}/.test(phone));
ck('phone pages: 诊断 group gated by ctx.showPooledHttp', /\{ctx\.showPooledHttp \? \([\s\S]{0,120}settings-diagnostics-group/.test(phone));
ck('phone ctx gets the same reveal result', /showPooledHttp: showPooledHttpDiagnostics\(versionTaps\.revealed, platform\)/.test(wide));

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
