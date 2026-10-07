// ck-style (self-executing; run by scripts/run-tests.mjs).
// 0.2.219 真机:设置窗口显示「已配置 ✓」,主窗口聊天输入框却提示「未配置语音识别，去设置」。
// 桌面版设置是单独窗口 = 单独 JS 环境:这里用两个 store(各自的缓存 + 订阅者)模拟两个窗口,
// 共用一份假钥匙串和一条假跨窗口通道。
import { createVoiceCredentialsStore, type VoiceCredentialsBus, type VoiceCredentialsStore } from './voice-credentials-store';
import { chooseRoute } from './voice-stream-policy';
import type { VoiceCredentials } from './voice-credentials-model';

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => { t++; if (cond) { p++; console.log(`✅ ${name}`); } else console.log(`❌ ${name}`); };
const tick = () => new Promise(r => setTimeout(r, 0));

// 假钥匙串(进程外 = 所有窗口共享,重启后还在)。
const keychain = { raw: null as string | null };
// 假 Tauri 全局事件:发给所有窗口,包括发送者自己。
const handlers: ((origin: string) => void)[] = [];
const bus: VoiceCredentialsBus = {
  post(origin) { for (const h of [...handlers]) setTimeout(() => h(origin), 0); },
  listen(h) { handlers.push(h); },
};
let reads = 0;
type Win = { store: VoiceCredentialsStore; focus: () => void };
const openWindow = (withBus = true): Win => {
  let focusHandler = () => {};
  const store = createVoiceCredentialsStore({
    async readRaw() { reads++; return keychain.raw; },
    async writeRaw(json) { keychain.raw = json; },
    async deleteRaw() { keychain.raw = null; },
    bus: withBus ? bus : null,
    onFocus: h => { focusHandler = h; },
  });
  return { store, focus: () => focusHandler() };
};

/** useVoiceInput 的「配没配」快照,原样照搬:订阅 → 重新 load → !!creds。 */
const composerHint = (w: Win) => {
  const s = { configured: false, renders: 0 };
  const refresh = () => w.store.load().then(c => { s.configured = !!c; s.renders++; });
  void refresh();
  w.store.subscribe(() => { void refresh(); });
  return s;
};

// 测试用的假值(不是任何真实密钥)。
const CREDS: VoiceCredentials = { appId: '', accessToken: 'fake-test-key-000000003ced', endpoint: '' };

(async () => {
  // ── 两个窗口:主窗口(聊天输入框)先打开,此时还没配 ──
  const main = openWindow();
  const hint = composerHint(main);
  await tick();
  ck('启动时未配置 → 输入框显示「未配置」', hint.configured === false);

  const settings = openWindow();
  ck('设置窗口读到未配置', (await settings.store.load()) === null);

  // ── 在设置窗口保存 ──
  await settings.store.save(CREDS);
  ck('设置窗口自己立刻是已配置', !!(await settings.store.load()));
  await tick(); await tick(); await tick();
  ck('保存后主窗口输入框立刻变成已配置(不用重启)', hint.configured === true);
  ck('主窗口 load() 拿到的是新存的凭据', (await main.store.load())?.accessToken === CREDS.accessToken);

  // ── 在设置窗口清除 ──
  await settings.store.clear();
  await tick(); await tick(); await tick();
  ck('清除后主窗口输入框立刻回到未配置', hint.configured === false);
  ck('主窗口不再拿着已清除的 Key', (await main.store.load()) === null);

  // ── 自己窗口发的广播不重复失效 ──
  {
    await settings.store.save(CREDS);
    await tick(); await tick(); await tick();
    const before = reads;
    await settings.store.load();
    ck('发送窗口忽略自己的广播(缓存仍在,不重读钥匙串)', reads === before);
  }

  // ── 重启:新窗口从钥匙串读 ──
  {
    const restarted = openWindow();
    const h2 = composerHint(restarted);
    await tick(); await tick();
    ck('重启后状态正确(已配置)', h2.configured === true);
    await settings.store.clear();
    const restarted2 = openWindow();
    const h3 = composerHint(restarted2);
    await tick(); await tick();
    ck('清除后重启 → 未配置', h3.configured === false);
  }

  // ── 广播丢了(没有跨窗口通道)→ 窗口重新获得焦点时兜底 ──
  {
    const lonelyMain = openWindow(false);
    const h = composerHint(lonelyMain);
    await tick();
    ck('兜底场景:一开始未配置', h.configured === false);
    keychain.raw = JSON.stringify(CREDS); // 另一个窗口写了钥匙串,但广播没送到
    await tick();
    ck('没广播、没焦点 → 还是旧值(说明下一条确实是焦点起的作用)', h.configured === false);
    lonelyMain.focus();
    await tick(); await tick();
    ck('窗口重新获得焦点 → 重读后变成已配置', h.configured === true);
  }

  // ── 读的过程中被失效:旧读数不能写回缓存 ──
  {
    keychain.raw = null;
    let release: (v: string | null) => void = () => {};
    const slow = createVoiceCredentialsStore({
      readRaw: () => new Promise(r => { release = r; }),
      async writeRaw() {}, async deleteRaw() {},
    });
    const pending = slow.load();
    slow.invalidate();
    release(null);
    await pending;
    let second: VoiceCredentials | null | undefined;
    const p2 = slow.load().then(c => { second = c; });
    release(JSON.stringify(CREDS));
    await p2;
    ck('读到一半被失效 → 下一次 load 重新读,拿到新值', second?.accessToken === CREDS.accessToken);
  }

  // ── 模型:桌面只有极速版,「配没配」不看模型 ──
  ck('桌面即使选了流式也走极速版(输入框不要求流式模型)', chooseRoute({ mode: 'stream', platform: 'desktop', streamUnavailable: false }) === 'flash');

  // ── 不泄露:广播里不带凭据 ──
  {
    const seen: string[] = [];
    const spy = createVoiceCredentialsStore({
      async readRaw() { return null; }, async writeRaw() {}, async deleteRaw() {},
      bus: { post(origin) { seen.push(String(origin)); }, listen() {} },
    });
    await spy.save(CREDS);
    ck('跨窗口广播只带来源 id,不带 Key', seen.length === 1 && !seen[0].includes(CREDS.accessToken));
  }

  console.log(`\n${p}/${t} passed`);
  process.exit(p === t ? 0 : 1);
})();
