// ck-style (self-executing; run by scripts/run-tests.mjs). #5653 Hub 统一发放语音 Key 单测与接线守卫。
import { readFileSync } from 'node:fs';
import type { HubConfig } from './api';
import {
  __resetHubVoiceForTest,
  clearHubVoiceConfig,
  EMPTY_HUB_VOICE,
  ensureHubVoiceCredentials,
  getHubVoiceCredentials,
  getHubVoiceSnapshot,
  hubVoiceReady,
  initialHubVoiceForm,
  mergeHubVoiceWrite,
  refreshHubVoiceConfig,
  saveHubVoiceConfig,
  setActiveHubVoiceConfig,
  subscribeHubVoice,
  type HubVoiceConfigState,
  type HubVoiceFetchLike,
} from './hub-voice';
import { filterSettings } from './settings-model';

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => { t++; if (cond) { p++; console.log(`✅ ${name}`); } else console.log(`❌ ${name}`); };

const cfgA: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_aaaa11112222', networkId: 'net_a', profileId: 'p_a' };
const cfgB: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_bbbb33334444', networkId: 'net_b', profileId: 'p_b' };

async function run() {
  // ── 1. Pure form validation (mergeHubVoiceWrite) ──
  {
    const unconfigured: HubVoiceConfigState = { ...EMPTY_HUB_VOICE, supported: true, loaded: true, canManage: true };
    const rEmpty = mergeHubVoiceWrite(unconfigured, initialHubVoiceForm(unconfigured));
    ck('首次保存未填 API Key 被拒绝', !rEmpty.ok && rEmpty.reasonKey === 'hubVoice.err.apiKeyRequired');

    const rWs = mergeHubVoiceWrite(unconfigured, { ...initialHubVoiceForm(unconfigured), apiKey: 'sk bad key' });
    ck('API Key 含空格被拒绝', !rWs.ok && rWs.reasonKey === 'hubVoice.err.secretWhitespace');

    const rHttp = mergeHubVoiceWrite(unconfigured, { ...initialHubVoiceForm(unconfigured), apiKey: 'sk-valid-1234', endpoint: 'http://evil.example/flash' });
    ck('非 https 自定义地址被拒绝', !rHttp.ok && rHttp.reasonKey === 'hubVoice.err.endpointInvalid');

    const rWsStream = mergeHubVoiceWrite(unconfigured, { ...initialHubVoiceForm(unconfigured), apiKey: 'sk-valid-1234', streamEndpoint: 'ws://evil.example/sauc' });
    ck('非 wss 流式地址被拒绝', !rWsStream.ok && rWsStream.reasonKey === 'hubVoice.err.streamEndpointInvalid');

    const rOk = mergeHubVoiceWrite(unconfigured, {
      ...initialHubVoiceForm(unconfigured),
      apiKey: 'sk-valid-1234',
      endpoint: 'https://asr.example/flash',
      streamEndpoint: 'wss://asr.example/sauc',
      streamResourceId: 'volc.seedasr.sauc.duration',
    });
    ck('新版 API Key + https/wss + 流式资源 ID 校验通过',
      rOk.ok
      && rOk.body.auth_mode === 'api-key'
      && rOk.body.access_token === 'sk-valid-1234'
      && rOk.body.endpoint === 'https://asr.example/flash'
      && rOk.body.stream_endpoint === 'wss://asr.example/sauc'
      && rOk.body.stream_resource_id === 'volc.seedasr.sauc.duration');

    const savedApiKey: HubVoiceConfigState = { ...unconfigured, configured: true, enabled: true, authMode: 'api-key', keyHint: '…1234' };
    const rToggle = mergeHubVoiceWrite(savedApiKey, { ...initialHubVoiceForm(savedApiKey), enabled: false });
    ck('同模式留空密钥允许更新开关（不强制重填 Key）', rToggle.ok && rToggle.body.enabled === false && rToggle.body.access_token === undefined);

    const rSwitchNoToken = mergeHubVoiceWrite(savedApiKey, { ...initialHubVoiceForm(savedApiKey), authMode: 'app-token', appId: '12345' });
    ck('切到旧版控制台必须重新填 Access Token', !rSwitchNoToken.ok && rSwitchNoToken.reasonKey === 'hubVoice.err.tokenRequired');

    const rBadAppId = mergeHubVoiceWrite(unconfigured, { ...initialHubVoiceForm(unconfigured), authMode: 'app-token', appId: 'bad id!', accessToken: 'tok-12345678' });
    ck('非法 App ID 被拒绝', !rBadAppId.ok && rBadAppId.reasonKey === 'hubVoice.err.appIdInvalid');

    const rOldOk = mergeHubVoiceWrite(unconfigured, { ...initialHubVoiceForm(unconfigured), authMode: 'app-token', appId: 'app_123', accessToken: 'tok-12345678' });
    ck('旧版 App ID + Access Token 校验通过', rOldOk.ok && rOldOk.body.auth_mode === 'app-token' && rOldOk.body.app_id === 'app_123');
  }

  // ── 2. Store lifecycle: config + key issuance + memory cache + rotation + isolation + 404 cache ──
  {
    __resetHubVoiceForTest();
    let notifies = 0;
    const unsub = subscribeHubVoice(() => { notifies++; });
    let configUrl = '';
    let credsCalls = 0;
    let currentUpdatedAt = 1700000000000;
    let currentSecret = 'volc-issued-key-9988';

    const okFetch: HubVoiceFetchLike = async (url) => {
      if (url.includes('/api/voice/config')) {
        configUrl = url;
        return {
          status: 200,
          json: async () => ({
            ok: true,
            network_id: 'net_a',
            enabled: true,
            configured: true,
            mode: 'hub-key',
            provider: 'doubao',
            auth_mode: 'api-key',
            app_id: '',
            key_hint: '…9988',
            endpoint: '',
            stream_endpoint: '',
            stream_resource_id: 'volc.seedasr.sauc.duration',
            can_manage: true,
            vault_ready: true,
            updated_at: currentUpdatedAt,
          }),
        };
      }
      if (url.includes('/api/voice/credentials')) {
        credsCalls++;
        return {
          status: 200,
          json: async () => ({
            ok: true,
            network_id: 'net_a',
            enabled: true,
            configured: true,
            mode: 'hub-key',
            provider: 'doubao',
            credentials: {
              provider: 'doubao',
              auth_mode: 'api-key',
              app_id: '',
              access_token: currentSecret,
              endpoint: '',
              stream_endpoint: '',
              stream_resource_id: 'volc.seedasr.sauc.duration',
            },
            updated_at: currentUpdatedAt,
          }),
        };
      }
      return { status: 404, json: async () => ({}) };
    };

    setActiveHubVoiceConfig(cfgA, { fetchImpl: okFetch });
    await new Promise(r => setTimeout(r, 15));
    ck('GET /api/voice/config 带 network_id 并自动预热内存凭据', configUrl === 'https://hub.example.test/api/voice/config?network_id=net_a' && hubVoiceReady() && getHubVoiceSnapshot().keyHint === '…9988');
    ck('订阅者收到更新通知', notifies >= 1);

    const c1 = await ensureHubVoiceCredentials(cfgA, { fetchImpl: okFetch });
    const c2 = await ensureHubVoiceCredentials(cfgA, { fetchImpl: okFetch });
    ck('ensureHubVoiceCredentials 命中内存缓存且仅拉取一次', c1?.accessToken === 'volc-issued-key-9988' && c1?.streamResourceId === 'volc.seedasr.sauc.duration' && c2 === c1 && credsCalls === 1);

    // Key rotation on Hub (updated_at changes) invalidates memory cache and fetches fresh key
    currentUpdatedAt = 1700000009999;
    currentSecret = 'volc-rotated-key-7777';
    await refreshHubVoiceConfig(cfgA, { fetchImpl: okFetch });
    await new Promise(r => setTimeout(r, 15));
    const c3 = await ensureHubVoiceCredentials(cfgA, { fetchImpl: okFetch });
    ck('Hub 密钥轮换（updated_at 变更）自动刷新内存凭据', c3?.accessToken === 'volc-rotated-key-7777' && credsCalls === 2);

    // Switch to another network where Hub returns 404 (older Hub)
    let calls404 = 0;
    const oldHubFetch: HubVoiceFetchLike = async () => {
      calls404++;
      return { status: 404, json: async () => ({ ok: false, error: 'not found' }) };
    };
    setActiveHubVoiceConfig(cfgB, { fetchImpl: oldHubFetch });
    await new Promise(r => setTimeout(r, 15));
    ck('切换网络立刻清空上一个网络的内存凭据，旧 Hub 404 静默降级', getHubVoiceCredentials() === null && !hubVoiceReady() && !getHubVoiceSnapshot().supported && getHubVoiceSnapshot().loaded);

    await refreshHubVoiceConfig(cfgB, { fetchImpl: oldHubFetch });
    ck('旧 Hub 404 缓存生效，后续轮询不再重复发请求', calls404 === 1);

    // Logout clears state & credentials immediately
    setActiveHubVoiceConfig(null);
    ck('登出清空 Hub 语音快照与内存凭据', !getHubVoiceSnapshot().loaded && !hubVoiceReady() && getHubVoiceCredentials() === null);
    unsub();
  }

  // ── 3. Admin PUT / DELETE updates reactive store & revokes cached credentials ──
  {
    __resetHubVoiceForTest();
    setActiveHubVoiceConfig(cfgA, {
      fetchImpl: async () => ({ status: 200, json: async () => ({ ok: true, enabled: false, configured: false, can_manage: true }) }),
    });
    await new Promise(r => setTimeout(r, 10));

    let seenMethod = '';
    let seenBody = '';
    const putRes = await saveHubVoiceConfig(cfgA, {
      enabled: true,
      provider: 'doubao',
      auth_mode: 'api-key',
      app_id: '',
      access_token: 'sk-admin-key-5653',
      endpoint: '',
      stream_endpoint: '',
      stream_resource_id: '',
    }, {
      fetchImpl: async (url, init) => {
        if (url.includes('/api/voice/credentials')) {
          return {
            status: 200,
            json: async () => ({
              ok: true,
              credentials: { auth_mode: 'api-key', app_id: '', access_token: 'sk-admin-key-5653', endpoint: '', stream_endpoint: '', stream_resource_id: '' },
              updated_at: 1700000010000,
            }),
          };
        }
        seenMethod = init.method ?? '';
        seenBody = init.body ?? '';
        return {
          status: 200,
          json: async () => ({
            ok: true,
            enabled: true,
            configured: true,
            mode: 'hub-key',
            auth_mode: 'api-key',
            key_hint: '…5653',
            can_manage: true,
            vault_ready: true,
            updated_at: 1700000010000,
          }),
        };
      },
    });
    await new Promise(r => setTimeout(r, 10));
    ck('saveHubVoiceConfig PUT 成功并同步更新快照与内存凭据', putRes.ok && seenMethod === 'PUT' && seenBody.includes('sk-admin-key-5653') && hubVoiceReady() && getHubVoiceCredentials()?.accessToken === 'sk-admin-key-5653');

    const delRes = await clearHubVoiceConfig(cfgA, {
      fetchImpl: async (_url, init) => ({
        status: 200,
        json: async () => ({ ok: true, enabled: false, configured: false, key_hint: '', can_manage: true, _m: init.method }),
      }),
    });
    ck('clearHubVoiceConfig DELETE 成功并立即清空内存凭据', delRes.ok && !hubVoiceReady() && !getHubVoiceSnapshot().configured && getHubVoiceCredentials() === null);

    // Stale in-flight GET must not overwrite a newer PUT/DELETE write
    let releaseStaleGet!: () => void;
    const staleGetPromise = refreshHubVoiceConfig(cfgA, {
      fetchImpl: () => new Promise(resolve => {
        releaseStaleGet = () => resolve({
          status: 200,
          json: async () => ({
            ok: true, enabled: true, configured: true, mode: 'hub-key', auth_mode: 'api-key',
            key_hint: '…old1', can_use: true, can_manage: true, updated_at: 1700000000001,
          }),
        });
      }),
    });
    await saveHubVoiceConfig(cfgA, {
      enabled: false, provider: 'doubao', auth_mode: 'api-key', app_id: '', endpoint: '', stream_endpoint: '', stream_resource_id: '',
    }, {
      fetchImpl: async () => ({
        status: 200,
        json: async () => ({
          ok: true, enabled: false, configured: true, mode: 'hub-key', auth_mode: 'api-key',
          key_hint: '…new2', can_use: true, can_manage: true, updated_at: 1700000020000,
        }),
      }),
    });
    releaseStaleGet();
    await staleGetPromise;
    ck('写操作后返回的陈旧 GET 不会覆盖最新停用状态', !getHubVoiceSnapshot().enabled && getHubVoiceSnapshot().keyHint === '…new2');

    // Read-only viewer (can_use: false) is never hubVoiceReady and does not fetch /api/voice/credentials
    let viewerCredsHit = false;
    await refreshHubVoiceConfig(cfgA, {
      fetchImpl: async (url) => {
        if (url.includes('/api/voice/credentials')) viewerCredsHit = true;
        return {
          status: 200,
          json: async () => ({
            ok: true, enabled: true, configured: true, mode: 'hub-key', auth_mode: 'api-key',
            key_hint: '…new2', can_use: false, can_manage: false, updated_at: 1700000020001,
          }),
        };
      },
    });
    await new Promise(r => setTimeout(r, 10));
    ck('只读成员 can_use=false 时 hubVoiceReady 为 false 且不请求 /api/voice/credentials', !hubVoiceReady() && !viewerCredsHit);

    // Bare { ok: true } fallback (non-voice route / stub) must not be treated as supported
    await refreshHubVoiceConfig(cfgA, {
      fetchImpl: async () => ({ status: 200, json: async () => ({ ok: true }) }),
    });
    ck('非语音接口返回的裸 { ok: true } 不误判为 supported', !getHubVoiceSnapshot().supported && !hubVoiceReady());
  }

  // ── 4. Web / HarmonyOS settings-model unlock & static safety guards ──
  {
    ck('纯网页默认（无 Hub 语音）仍隐藏语音设置', !filterSettings('', {}, undefined, 'web').some(c => c.key === 'voice'));
    const webEnabled = filterSettings('', { voice: true }, undefined, 'web').find(c => c.key === 'voice');
    ck('网页/鸿蒙在 Hub 语音可用时展示 hub/mic/test 行', !!webEnabled && JSON.stringify(webEnabled.rows.map(r => r.key)) === JSON.stringify(['hub', 'mic', 'test']));

    for (const f of ['src/hub-voice.ts', 'src/HubVoiceSettingsCard.tsx']) {
      const src = readFileSync(f, 'utf8');
      ck(`${f} 没有 console.*（音频与密钥安全红线）`, !/\bconsole\.(log|info|warn|error|debug)\b/.test(src));
      ck(`${f} 不把密钥写进 localStorage`, !/localStorage\s*[.[]/.test(src));
    }
    const appSrc = readFileSync('App.tsx', 'utf8');
    ck('App.tsx 接入 setActiveHubVoiceConfig(cfg) 与轮询刷新', appSrc.includes('setActiveHubVoiceConfig(cfg)') && appSrc.includes('refreshHubVoiceConfig(cfg)'));
    const hookSrc = readFileSync('src/useVoiceInput.ts', 'utf8');
    ck('useVoiceInput 按下守卫与识别链路均包含 hubVoiceReady（零配置按住说话直接开录）',
      hookSrc.includes('hubVoiceReady(hubVoice)')
      && hookSrc.includes('configured: getConfigured() || hubVoiceReady()')
      && hookSrc.includes('loadCreds: loadEffectiveVoiceCredentials')
      && hookSrc.includes('transcribeCaptured(await loadEffectiveVoiceCredentials(), captured)'));
  }

  console.log(`hub voice: ${p}/${t} checks passed`);
  process.exit(p === t ? 0 : 1);
}

void run();
