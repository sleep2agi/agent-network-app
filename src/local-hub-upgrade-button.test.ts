import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// app#246 —— 设置页「升级本地 Hub」按钮与 expectedHubVersion 字段的接线契约(源码扫描)。
let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; };
const settings = readFileSync(new URL('./SettingsScreen.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const localHub = readFileSync(new URL('./local-hub.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const rust = readFileSync(new URL('../src-tauri/src/local_hub.rs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

check(localHub.includes('expectedHubVersion?: string;'), 'LocalHubResult carries expectedHubVersion');
check(rust.includes('expected_hub_version: String,'), 'Rust LocalHubResult declares expected_hub_version');
check((rust.match(/expected_hub_version: EXPECTED_HUB_VERSION\.into\(\),/g) ?? []).length === (rust.match(/^\s+requires_migration: (?!bool)/gm) ?? []).length, 'every LocalHubResult literal sets expected_hub_version');
check(settings.includes('testID="local-hub-upgrade"'), 'settings renders the upgrade button');
check(settings.includes("localHub.requiresMigration || (localHub.error ?? '').includes('version mismatch')"), 'upgrade button shows on requiresMigration or version-mismatch error');
const button = settings.slice(settings.indexOf('testID="local-hub-upgrade"'), settings.indexOf('testID="local-hub-upgrade"') + 700);
check(button.includes('restartLocalHub()'), 'upgrade button restarts the local Hub (stale takeover lives in start_local_hub)');
check(button.includes('升级本地 Hub 到 ${localHub.expectedHubVersion'), 'button label names the bundled Hub version');
check(rust.includes('fn stop_stale_process(pid: u32, port: u16)') && rust.includes('stale_owner_taken_over = true;'), 'start_local_hub takes over a stale owned sidecar on version mismatch');
check(rust.includes('pub fn packaged_stale_hub_takeover_smoke()'), 'packaged stale-takeover smoke exists');
const workflow = readFileSync(new URL('../.github/workflows/release-desktop-auto-update.yml', import.meta.url), 'utf8');
check(workflow.includes('--smoke-local-hub-stale-takeover') && workflow.includes('seed-previous-local-hub.mjs --keep-running'), 'release gate runs the stale-takeover smoke with the keep-running fixture');
console.log(`local hub upgrade button: ${ck} checks passed`);
