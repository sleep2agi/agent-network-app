// ck-style (self-executing; run by scripts/run-tests.mjs). #5653 Hub 统一语音输入（ASR）单测与接线守卫。
import { readFileSync } from 'node:fs';
import { AsrError, MAX_WAV_BYTES } from './doubao-asr';
import type { HubConfig } from './api';
import {
  __resetHubVoiceForTest,
  clearHubVoiceConfig,
  EMPTY_HUB_VOICE,
  getHubVoiceSnapshot,
  hubVoiceReady,
  initialHubVoiceForm,
  mergeHubVoiceWrite,
  refreshHubVoiceConfig,
  saveHubVoiceConfig,
  setActiveHubVoiceConfig,
  subscribeHubVoice,
  transcribeViaHub,
  type HubVoiceConfigState,
  type HubVoiceFetchLike,
} from './hub-voice';
import { filterSettings } from './settings-model';

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => { t++; if (cond) { p++; console.log(`✅ ${name}`); } else console.log(`❌ ${name}`); };

const cfgA: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_aaaa11112222', networkId: 'net_a', profileId: 'p_a' };
const cfgB: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_bbbb33334444', networkId: 'net_b', profileId: 'p_b' };
const sampleWav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00]);

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

    const rOk = mergeHubVoiceWrite(unconfigured, { ...initialHubVoiceForm(unconfigured), apiKey: 'sk-valid-1234', endpoint: 'https://asr.example/flash' });
    ck('新版 API Key + https 地址校验通过', rOk.ok && rOk.body.auth_mode === 'api-key' && rOk.body.access_token === 'sk-valid-1234' && rOk.body.endpoint === 'https://asr.example/flash');

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

  // ── 2. Store lifecycle: fetch, subscribe, account/network isolation, old Hub 404 cache ──
  {
    __resetHubVoiceForTest();
    let notifies = 0;
    const unsub = subscribeHubVoice(() => { notifies++; });
    let seenUrl = '';
    let seenAuth = '';
    const okFetch: HubVoiceFetchLike = async (url, init) => {
      seenUrl = url;
      seenAuth = init.headers.Authorization ?? '';
      return {
        status: 200,
        json: async () => ({
          ok: true,
          network_id: 'net_a',
          enabled: true,
          configured: true,
          mode: 'hub-proxy',
          provider: 'doubao',
          auth_mode: 'api-key',
          app_id: '',
          key_hint: '…9988',
          endpoint: '',
          can_manage: true,
          vault_ready: true,
          updated_at: 1700000000000,
        }),
      };
    };

    setActiveHubVoiceConfig(cfgA, { fetchImpl: okFetch });
    await new Promise(r => setTimeout(r, 10));
    ck('GET /api/voice/config 带 network_id 与 Bearer token', seenUrl === 'https://hub.example.test/api/voice/config?network_id=net_a' && seenAuth === 'Bearer utok_aaaa11112222');
    ck('启用且已配置时 hubVoiceReady() 为 true', hubVoiceReady() && getHubVoiceSnapshot().keyHint === '…9988' && getHubVoiceSnapshot().canManage);
    ck('订阅者收到更新通知', notifies >= 1);

    // Switch to another network where Hub returns 404 (older Hub)
    let calls404 = 0;
    const oldHubFetch: HubVoiceFetchLike = async () => {
      calls404++;
      return { status: 404, json: async () => ({ ok: false, error: 'not found' }) };
    };
    setActiveHubVoiceConfig(cfgB, { fetchImpl: oldHubFetch });
    await new Promise(r => setTimeout(r, 10));
    ck('切换网络后立刻隔离状态，旧 Hub 404 静默降级为 supported=false', !hubVoiceReady() && !getHubVoiceSnapshot().supported && getHubVoiceSnapshot().loaded);

    await refreshHubVoiceConfig(cfgB, { fetchImpl: oldHubFetch });
    ck('旧 Hub 404 缓存生效，后续轮询不再重复发请求', calls404 === 1);

    // Logout clears state immediately
    setActiveHubVoiceConfig(null);
    ck('登出清空 Hub 语音快照', !getHubVoiceSnapshot().loaded && !hubVoiceReady());
    unsub();
  }

  // ── 3. Admin PUT / DELETE updates reactive store ──
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
    }, {
      fetchImpl: async (_url, init) => {
        seenMethod = init.method ?? '';
        seenBody = init.body ?? '';
        return {
          status: 200,
          json: async () => ({
            ok: true,
            enabled: true,
            configured: true,
            auth_mode: 'api-key',
            key_hint: '…5653',
            can_manage: true,
            vault_ready: true,
          }),
        };
      },
    });
    ck('saveHubVoiceConfig PUT 成功并同步更新本地快照', putRes.ok && seenMethod === 'PUT' && seenBody.includes('sk-admin-key-5653') && hubVoiceReady() && getHubVoiceSnapshot().keyHint === '…5653');

    const delRes = await clearHubVoiceConfig(cfgA, {
      fetchImpl: async (_url, init) => ({
        status: 200,
        json: async () => ({ ok: true, enabled: false, configured: false, key_hint: '', can_manage: true, _m: init.method }),
      }),
    });
    ck('clearHubVoiceConfig DELETE 成功并关闭 hubVoiceReady', delRes.ok && !hubVoiceReady() && !getHubVoiceSnapshot().configured);
  }

  // ── 4. transcribeViaHub proxy mapping & safety ──
  {
    let recBody = '';
    const text = await transcribeViaHub(cfgA, sampleWav, {
      fetchImpl: async (url, init) => {
        recBody = `${url}|${init.body ?? ''}`;
        return { status: 200, json: async () => ({ ok: true, text: '  你好 ANet  ' }) };
      },
    });
    ck('transcribeViaHub POST /api/voice/recognize 返回 trim 后文本', text === '你好 ANet' && recBody.includes('/api/voice/recognize?network_id=net_a') && recBody.includes('wav_base64'));

    const silent = await transcribeViaHub(cfgA, sampleWav, {
      fetchImpl: async () => ({ status: 200, json: async () => ({ ok: true, text: '' }) }),
    });
    ck('静音返回空串不抛错', silent === '');

    // Hub maps upstream 401 -> HTTP 502 { code: 'auth_failed' }
    let caught: AsrError | null = null;
    try {
      await transcribeViaHub(cfgA, sampleWav, {
        fetchImpl: async () => ({ status: 502, json: async () => ({ ok: false, code: 'auth_failed', upstream: '401' }) }),
      });
    } catch (e) { caught = e as AsrError; }
    ck('HTTP 502 auth_failed 正确映射为 AsrError(auth_failed, 401)', caught instanceof AsrError && caught.code === 'auth_failed' && caught.upstream === '401');

    let caughtLong: AsrError | null = null;
    try {
      await transcribeViaHub(cfgA, new Uint8Array(MAX_WAV_BYTES + 1), {
        fetchImpl: async () => { throw new Error('should not fetch'); },
      });
    } catch (e) { caughtLong = e as AsrError; }
    ck('超过 MAX_WAV_BYTES 在发请求前即拦截为 too_long', caughtLong instanceof AsrError && caughtLong.code === 'too_long');

    let caughtTimeout: AsrError | null = null;
    try {
      await transcribeViaHub(cfgA, sampleWav, {
        timeoutMs: 15,
        fetchImpl: () => new Promise(() => {}),
      });
    } catch (e) { caughtTimeout = e as AsrError; }
    ck('请求超时抛 AsrError(timeout)', caughtTimeout instanceof AsrError && caughtTimeout.code === 'timeout');
  }

  // ── 5. Web / HarmonyOS settings-model unlock & static safety guards ──
  {
    ck('纯网页默认（无 Hub 语音）仍隐藏语音设置', !filterSettings('', {}, undefined, 'web').some(c => c.key === 'voice'));
    const webEnabled = filterSettings('', { voice: true }, undefined, 'web').find(c => c.key === 'voice');
    ck('网页/鸿蒙在 Hub 语音可用时展示 hub/mic/test 行', !!webEnabled && JSON.stringify(webEnabled.rows.map(r => r.key)) === JSON.stringify(['hub', 'mic', 'test']));

    for (const f of ['src/hub-voice.ts', 'src/HubVoiceSettingsCard.tsx']) {
      ck(`${f} 没有 console.*（音频与密钥安全红线）`, !/\bconsole\.(log|info|warn|error|debug)\b/.test(readFileSync(f, 'utf8')));
    }
    const appSrc = readFileSync('App.tsx', 'utf8');
    ck('App.tsx 接入 setActiveHubVoiceConfig(cfg) 与轮询刷新', appSrc.includes('setActiveHubVoiceConfig(cfg)') && appSrc.includes('refreshHubVoiceConfig(cfg)'));
    const hookSrc = readFileSync('src/useVoiceInput.ts', 'utf8');
    ck('useVoiceInput 结合 hubVoiceReady 解锁 available/configured 并优先本地回落 Hub', hookSrc.includes('hubVoiceReady(hubVoice)') && hookSrc.includes('transcribeViaHub(getActiveHubVoiceConfig(), wav)'));
  }

  console.log(`hub voice: ${p}/${t} checks passed`);
  process.exit(p === t ? 0 : 1);
}

void run();
