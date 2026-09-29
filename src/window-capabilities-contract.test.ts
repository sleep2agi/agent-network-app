// ck-style. Every native window this app creates must be listed in capabilities/default.json
// `windows` — otherwise the new window gets no permissions at all and every invoke (http fetch,
// window ops, events) is rejected. That is exactly 0.2.56: `workspace-*` was not listed, the build
// and tests were green, only a real window showed 「plugin:http|fetch not allowed by ACL」.
//
// Two layers (CLAUDE.md ⑤ — criterion and collection are different things):
//   collection: find EVERY window-creation call site (`new WebviewWindow(` in src/**, recursive, and
//               `WebviewWindowBuilder::new(` in src-tauri/src/**). A call site this file does not
//               know fails the test — register its label below AND in capabilities.
//   criterion:  every registered label is covered by a `windows` pattern.
// Plus what the 「图片预览」 window itself needs (clipboard image, save dialog, title, close).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { chatWindowLabel, workspaceWindowLabel } from './desktop-chat-menu';
import { SETTINGS_WINDOW_LABEL } from './desktop-settings-window';
import { IMAGE_WINDOW_LABEL } from './image-window-model';

let p = 0, t = 0;
const ck = (name: string, cond: boolean, detail = '') => { t++; if (cond) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`); };

// 🔴 Windows checkouts are CRLF and use `\`: normalise both or every includes/key below misfires.
const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n?/g, '\n');
const posix = (f: string) => f.split(sep).join('/');

function walk(dir: string, keep: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) out.push(...walk(f, keep));
    else if (keep(f)) out.push(f);
  }
  return out;
}

/** file (posix, repo-relative) → the labels its window-creation call sites mint (a sample of each shape). */
const KNOWN: Record<string, string[]> = {
  'src/desktop-chat-menu.ts': [chatWindowLabel('示例-A', 'p-1'), workspaceWindowLabel('p-1')],
  'src/image-window.ts': [IMAGE_WINDOW_LABEL],
  'src/desktop-settings-window.ts': [SETTINGS_WINDOW_LABEL],
  'src-tauri/src/tray.rs': ['tray-panel'],
};

const countSites = (src: string, needle: RegExp) => (src.match(needle) ?? []).length;
const tsFiles = walk('src', f => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
const rsFiles = walk('src-tauri/src', f => f.endsWith('.rs'));
const sites = new Map<string, number>();
for (const f of tsFiles) { const n = countSites(read(f), /new WebviewWindow\(/g); if (n) sites.set(posix(relative('.', f)), n); }
for (const f of rsFiles) { const n = countSites(read(f), /WebviewWindowBuilder::new\(/g); if (n) sites.set(posix(relative('.', f)), n); }

// collection self-check: the walk must actually see the files we know create windows (a
// non-recursive glob or a wrong suffix would read as 「0 unknown call sites」 = green).
ck('collection sees src/desktop-chat-menu.ts (2 sites: chat + workspace)', sites.get('src/desktop-chat-menu.ts') === 2, JSON.stringify([...sites]));
ck('collection sees src/image-window.ts', (sites.get('src/image-window.ts') ?? 0) >= 1, JSON.stringify([...sites]));
ck('collection sees src/desktop-settings-window.ts', (sites.get('src/desktop-settings-window.ts') ?? 0) >= 1, JSON.stringify([...sites]));
ck('collection sees src-tauri/src/tray.rs', (sites.get('src-tauri/src/tray.rs') ?? 0) >= 1, JSON.stringify([...sites]));
ck('collection recurses into subdirectories (src/lib/avatars.ts is collected)', tsFiles.map(posix).includes('src/lib/avatars.ts'));
const unknown = [...sites.keys()].filter(f => !KNOWN[f]);
ck('every window-creation call site is registered here (label → capabilities)', unknown.length === 0, `unregistered: ${unknown.join(', ')}`);

const caps = JSON.parse(read('src-tauri/capabilities/default.json')) as { windows?: string[]; permissions: unknown[] };
const granted = caps.windows ?? [];
const covers = (label: string) => granted.some(pattern => pattern === label || (pattern.endsWith('*') && label.startsWith(pattern.slice(0, -1))));
for (const [file, labels] of Object.entries(KNOWN)) {
  for (const label of labels) ck(`capabilities windows cover ${label} (${file})`, covers(label), JSON.stringify(granted));
}
ck('capabilities windows cover main', covers('main'));
ck('the image window label is listed exactly (not via a broad wildcard)', granted.includes(IMAGE_WINDOW_LABEL));

// the tray label in tray.rs is the one registered above
ck('tray.rs PANEL_LABEL is tray-panel', read('src-tauri/src/tray.rs').includes('pub const PANEL_LABEL: &str = "tray-panel";'));
// image-window.ts creates with IMAGE_WINDOW_LABEL (not a literal that could drift)
ck('image-window.ts creates the window with IMAGE_WINDOW_LABEL', read('src/image-window.ts').includes('new WebviewWindow(IMAGE_WINDOW_LABEL,'));

// ── what the 图片预览 window uses ──
const perms = caps.permissions.map(x => (typeof x === 'string' ? x : (x as { identifier?: string }).identifier ?? ''));
for (const need of [
  'core:default',                          // events (show/ready/close), window getters, onMoved/onResized
  'core:webview:allow-create-webview-window',
  'core:window:allow-set-focus', 'core:window:allow-show', 'core:window:allow-unminimize',
  'core:window:allow-close',               // Esc
  'core:window:allow-set-title',           // title follows the image
  'clipboard-manager:allow-write-image',   // Ctrl/⌘+C
  'dialog:allow-save',                     // 另存为…
  'opener:allow-open-url',                 // 在浏览器打开
  'http:default',                          // authed image bytes via plugin-http
]) ck(`permission ${need}`, perms.includes(need), perms.join(' '));

const cargo = read('src-tauri/Cargo.toml');
const lib = read('src-tauri/src/lib.rs');
const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
ck('clipboard plugin: Rust crate', /^tauri-plugin-clipboard-manager = "2"/m.test(cargo));
ck('clipboard plugin: registered in the builder', lib.includes('.plugin(tauri_plugin_clipboard_manager::init())'));
ck('clipboard plugin: JS package', !!pkg.dependencies['@tauri-apps/plugin-clipboard-manager']);
ck('tauri keeps image-png (writeImage decodes PNG bytes)', /tauri = \{[^}]*"image-png"/.test(cargo));
// `tauri build` refuses mismatched major.minor between a Rust crate and its npm package — the
// release build would be the first to notice (the npm plugin 2.4 pulls @tauri-apps/api 2.12).
{
  const lockRs = read('src-tauri/Cargo.lock');
  const lockJs = JSON.parse(read('package-lock.json')) as { packages: Record<string, { version?: string }> };
  const crate = (name: string) => lockRs.match(new RegExp(`name = "${name}"\\nversion = "(\\d+\\.\\d+)`))?.[1];
  const npm = (name: string) => lockJs.packages[`node_modules/${name}`]?.version?.match(/^\d+\.\d+/)?.[0];
  for (const [rs, js] of [['tauri', '@tauri-apps/api'], ['tauri-plugin-clipboard-manager', '@tauri-apps/plugin-clipboard-manager']]) {
    ck(`${rs} ${crate(rs)} ↔ ${js} ${npm(js)}: same major.minor`, !!crate(rs) && crate(rs) === npm(js));
  }
}

// ── wiring the fallback + platform branch ──
const chat = read('src/ChatScreen.tsx');
ck('ChatScreen branches on imagePreviewSurface', chat.includes("imagePreviewSurface(viewerEnv) !== 'window'"));
ck('ChatScreen falls back to the in-app viewer when the window fails', chat.includes('if (!ok) setViewer(inApp)'));
ck('ChatScreen still mounts the in-app ImageViewer (phone / web / fallback)', chat.includes('<ImageViewer state={viewer}'));
const app = read('App.tsx');
ck('App routes ?imageViewer=1 to the viewer page (Tauri only)', app.includes('readImageWindowRoute(') && app.includes('<ImageViewerWindow />'));
// no credential crosses the event bus
const opener = read('src/image-window.ts');
ck('opener module never touches a token', !/token/i.test(opener.replace(/\/\/.*$/gm, '')));

console.log(`\nwindow-capabilities-contract: ${p}/${t} passed`);
if (p !== t) process.exit(1);
