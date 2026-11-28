// Unit & wiring tests for Hub external storage relay (ModelScope / Aliyun OSS / AWS S3).
// Run: bun src/hub-storage.test.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HubConfig } from './api';
import {
  __resetHubStorageForTest,
  clearHubStorageConfig,
  EMPTY_HUB_STORAGE,
  getHubStorageSnapshot,
  initialHubStorageForm,
  mergeHubStorageWrite,
  refreshHubStorageConfig,
  saveHubStorageConfig,
  setActiveHubStorageConfig,
  testHubStorageConfig,
  type HubStorageFetchLike,
} from './hub-storage';
import {
  appendHubProxyParam,
  computeSha256Hex,
  directFileDescriptorUrl,
  extractFileIdFromUrl,
  HUB_LOCAL_FALLBACK_MAX_BYTES,
  resolveDirectDownloadTarget,
  sha256HexSync,
  tryDirectUploadBytes,
  tryNativeDirectUpload,
} from './direct-storage';
import { downloadAuthedBytes } from './desktop-download';
import { downloadAttachmentWith, type DownloadFs } from './attach-download';
import { setLanguagePreference, t } from './i18n';
import './i18n-hub-storage';

let pass = 0;
let total = 0;
const ck = (name: string, ok: boolean, extra = '') => {
  total++;
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`);
  }
};

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const cfgA: HubConfig = {
  serverUrl: 'https://hub-a.example.com',
  token: 'utok_owner_a_secret_123456',
  networkId: 'net_alpha',
  profileId: 'prof_a',
};
const cfgB: HubConfig = {
  serverUrl: 'https://hub-b.example.com',
  token: 'utok_member_b_secret_654321',
  networkId: 'net_beta',
  profileId: 'prof_b',
};

const run = async () => {
  console.log('# 1 SHA-256 pure-JS & WebCrypto parity (NIST FIPS 180-4 vectors)');
  {
    // SHA-256("") and SHA-256("abc")
    ck('sha256HexSync("") matches NIST vector', sha256HexSync(new Uint8Array(0)) === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    ck('sha256HexSync("abc") matches NIST vector', sha256HexSync(new TextEncoder().encode('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const longMsg = new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq');
    const expectedLong = '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1';
    ck('sha256HexSync(multi-block) matches NIST vector', sha256HexSync(longMsg) === expectedLong);
    ck('computeSha256Hex matches sync vector', (await computeSha256Hex(longMsg)) === expectedLong);
  }

  console.log('# 2 Form validation & mergeHubStorageWrite');
  {
    const base = { ...EMPTY_HUB_STORAGE, supported: true, loaded: true, canManage: true };
    const rBadRepo = mergeHubStorageWrite(base, { ...initialHubStorageForm(base), repoId: 'not-a-repo', apiToken: 'tok_12345678' });
    ck('ModelScope: rejects invalid repo_id', !rBadRepo.ok && rBadRepo.reasonKey === 'hubStorage.err.repoIdRequired');

    const rNoTok = mergeHubStorageWrite(base, { ...initialHubStorageForm(base), repoId: 'owner/anet-files', apiToken: '' });
    ck('ModelScope: requires token on first save', !rNoTok.ok && rNoTok.reasonKey === 'hubStorage.err.tokenRequired');

    const rOkMs = mergeHubStorageWrite(base, { ...initialHubStorageForm(base), repoId: 'owner/anet-files', apiToken: 'ms_tok_12345678', maxFileMb: '200' });
    ck('ModelScope: builds valid payload', rOkMs.ok && rOkMs.body.provider === 'modelscope' && rOkMs.body.repo_id === 'owner/anet-files' && rOkMs.body.max_file_bytes === 200 * 1024 * 1024);

    const savedMs = { ...base, configured: true, enabled: true, provider: 'modelscope' as const, repoId: 'owner/anet-files', keyHint: '…5678' };
    const rKeepSecret = mergeHubStorageWrite(savedMs, { ...initialHubStorageForm(savedMs), apiToken: '', prefix: 'media' });
    ck('ModelScope: blank token keeps existing secret on same provider', rKeepSecret.ok && rKeepSecret.body.api_token === undefined && rKeepSecret.body.prefix === 'media');

    const rOssBad = mergeHubStorageWrite(base, { ...initialHubStorageForm(base), provider: 'oss', bucket: 'my-bucket', region: 'cn-hangzhou', accessKeyId: 'AK123', accessKeySecret: '' });
    ck('OSS: requires both AK and SK together', !rOssBad.ok && rOssBad.reasonKey === 'hubStorage.err.akSkRequired');

    const rOssOk = mergeHubStorageWrite(base, { ...initialHubStorageForm(base), provider: 'oss', bucket: 'my-bucket', region: 'oss-cn-hangzhou', accessKeyId: 'LTAI5t1234', accessKeySecret: 'Secret9999' });
    ck('OSS: builds valid payload', rOssOk.ok && rOssOk.body.provider === 'oss' && rOssOk.body.bucket === 'my-bucket');

    const rBadSize = mergeHubStorageWrite(base, { ...initialHubStorageForm(base), repoId: 'a/b', apiToken: 'tok123456', maxFileMb: '999' });
    ck('Rejects maxFileMb > 500', !rBadSize.ok && rBadSize.reasonKey === 'hubStorage.err.maxSizeInvalid');

    const rNoPubUrl = mergeHubStorageWrite(base, { ...initialHubStorageForm(base), repoId: 'a/b', apiToken: 'tok123456', publicBaseUrl: 'https://cdn.example.com/public' });
    ck('Strict private-only: mergeHubStorageWrite never sends non-empty public_base_url', rNoPubUrl.ok && rNoPubUrl.body.public_base_url === '');

    const rS3Accel = mergeHubStorageWrite(base, {
      ...initialHubStorageForm(base),
      provider: 's3',
      bucket: 'anet-private-usw1',
      region: 'us-west-1',
      endpoint: 'https://s3-accelerate.amazonaws.com',
      accessKeyId: 'AKIA123456',
      accessKeySecret: 'Secret999999',
    });
    ck('AWS S3: accepts Transfer Acceleration endpoint', rS3Accel.ok && rS3Accel.body.endpoint === 'https://s3-accelerate.amazonaws.com');
  }

  console.log('# 3 Reactive store: refresh, scope isolation, old Hub 404 downgrade, test & clear');
  {
    __resetHubStorageForTest();
    const okFetch: HubStorageFetchLike = async (url, init) => {
      if (url.includes('/api/storage/config') && init.method === 'GET') {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            ok: true,
            network_id: 'net_alpha',
            enabled: true,
            configured: true,
            provider: 'modelscope',
            repo_id: 'team/anet-files',
            repo_type: 'dataset',
            revision: 'master',
            prefix: 'anet-files',
            endpoint: '',
            public_base_url: '',
            max_file_bytes: 150 * 1024 * 1024,
            key_hint: '…9876',
            can_manage: true,
            vault_ready: true,
            updated_at: 1700000000000,
          }),
        };
      }
      if (url.includes('/api/storage/test') && init.method === 'POST') {
        return {
          status: 400,
          ok: false,
          json: async () => ({
            ok: false,
            provider: 'modelscope',
            latency_ms: 42,
            visibility: 'public',
            error: 'public_storage_forbidden',
            message: '安全策略禁止使用公开（Public）ModelScope 仓库',
          }),
        };
      }
      if (url.includes('/api/storage/config') && init.method === 'DELETE') {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            ok: true,
            network_id: 'net_alpha',
            enabled: false,
            configured: false,
            provider: 'modelscope',
            key_hint: '',
            can_manage: true,
            vault_ready: true,
            updated_at: null,
          }),
        };
      }
      return { status: 404, ok: false, json: async () => ({ ok: false }) };
    };

    setActiveHubStorageConfig(cfgA, { fetchImpl: okFetch });
    await refreshHubStorageConfig(cfgA, { fetchImpl: okFetch, force: true });
    const snapA = getHubStorageSnapshot();
    ck('Loads ModelScope config state from Hub', snapA.supported && snapA.enabled && snapA.provider === 'modelscope' && snapA.repoId === 'team/anet-files' && snapA.maxFileBytes === 150 * 1024 * 1024);

    const testRes = await testHubStorageConfig(cfgA, null, { fetchImpl: okFetch });
    ck('Test endpoint surfaces public_storage_forbidden hard rejection', !testRes.ok && testRes.error === 'public_storage_forbidden' && testRes.latencyMs === 42 && testRes.visibility === 'public');

    const cleared = await clearHubStorageConfig(cfgA, { fetchImpl: okFetch });
    ck('DELETE clears Hub storage config', cleared.ok && !getHubStorageSnapshot().configured && !getHubStorageSnapshot().enabled);

    // Old Hub 404 silently degrades to supported=false
    const oldHubFetch: HubStorageFetchLike = async () => ({ status: 404, ok: false, json: async () => ({ error: 'not found' }) });
    setActiveHubStorageConfig(cfgB, { fetchImpl: oldHubFetch });
    await refreshHubStorageConfig(cfgB, { fetchImpl: oldHubFetch, force: true });
    ck('Old Hub 404 silently sets supported=false', !getHubStorageSnapshot().supported && getHubStorageSnapshot().loaded);

    setActiveHubStorageConfig(null);
    ck('Logout resets snapshot to empty', !getHubStorageSnapshot().loaded && !getHubStorageSnapshot().enabled);
  }

  console.log('# 4 Direct upload & download protocol + plain browser Cookie fallback');
  {
    const bytes = new TextEncoder().encode('fake-video-payload-bytes-1234567890');
    const calls: string[] = [];
    const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method || 'GET'} ${url}`);
      if (url.endsWith('/api/uploads/presign')) {
        return Response.json({
          ok: true,
          mode: 'direct',
          provider: 'modelscope',
          file_id: 'abcdef1234567890abcdef1234567890',
          skip_upload: false,
          upload: {
            method: 'PUT',
            url: 'https://www.modelscope.cn/lfs/put/blob1',
            headers: { Authorization: 'Bearer ms_tok', Cookie: 'm_session_id=ms_tok' },
          },
        });
      }
      if (url === 'https://www.modelscope.cn/lfs/put/blob1') {
        const h = (init?.headers || {}) as Record<string, string>;
        ck('Direct PUT uses provider headers (never Hub token)', h.Authorization === 'Bearer ms_tok');
        return new Response('', { status: 200 });
      }
      if (url.endsWith('/api/uploads/complete')) {
        return Response.json({
          ok: true,
          file_id: 'abcdef1234567890abcdef1234567890',
          url: '/api/files/abcdef1234567890abcdef1234567890',
          size: bytes.byteLength,
          mime: 'video/mp4',
          storage_provider: 'modelscope',
        });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    // Tauri Desktop (isPlainBrowser=false): succeeds end-to-end with 0 bytes to Hub
    const upDesktop = await tryDirectUploadBytes({
      serverUrl: 'https://hub.example.com',
      token: 'utok_hub_only',
      bytes,
      name: 'demo.mp4',
      mime: 'video/mp4',
      isPlainBrowser: false,
      fetchImpl: fetchMock,
    });
    ck('Desktop direct upload completes via presign -> PUT -> complete', upDesktop.kind === 'uploaded' && upDesktop.file.file_id === 'abcdef1234567890abcdef1234567890');
    ck('Desktop direct upload hits exact 3 endpoints', calls.length === 3);

    // Plain web browser with Cookie header: cleanly falls back to Hub upload
    const upBrowser = await tryDirectUploadBytes({
      serverUrl: 'https://hub.example.com',
      token: 'utok_hub_only',
      bytes,
      name: 'demo.mp4',
      mime: 'video/mp4',
      isPlainBrowser: true,
      fetchImpl: fetchMock,
    });
    ck('Plain web browser falls back when PUT requires forbidden Cookie header', upBrowser.kind === 'fallback_hub' && upBrowser.corsFallback === true);

    // Direct download resolution
    ck('extractFileIdFromUrl extracts valid id', extractFileIdFromUrl('https://hub.test/api/files/abcdef1234567890') === 'abcdef1234567890');
    ck('directFileDescriptorUrl rejects short test id', directFileDescriptorUrl('https://hub.test/api/files/x') === null);

    const dlDirect = await resolveDirectDownloadTarget({
      fileUrl: 'https://hub.test/api/files/abcdef1234567890',
      token: 'utok_hub',
      isPlainBrowser: false,
      fetchImpl: (async () => Response.json({
        ok: true,
        mode: 'direct',
        provider: 'modelscope',
        url: 'https://www.modelscope.cn/api/v1/datasets/a/b/repo?FilePath=x',
        headers: { Authorization: 'Bearer ms_tok', Cookie: 'm_session_id=ms_tok' },
      })) as typeof fetch,
    });
    ck('resolveDirectDownloadTarget returns direct ModelScope URL on desktop', dlDirect.kind === 'direct' && dlDirect.url.includes('modelscope.cn'));

    const dlBrowserFallback = await resolveDirectDownloadTarget({
      fileUrl: 'https://hub.test/api/files/abcdef1234567890',
      token: 'utok_hub',
      isPlainBrowser: true,
      fetchImpl: (async () => Response.json({
        ok: true,
        mode: 'direct',
        provider: 'modelscope',
        url: 'https://www.modelscope.cn/api/v1/datasets/a/b/repo?FilePath=x',
        headers: { Authorization: 'Bearer ms_tok', Cookie: 'm_session_id=ms_tok' },
      })) as typeof fetch,
    });
    ck('Plain web browser skips direct ModelScope Cookie download (uses Hub proxy)', dlBrowserFallback.kind === 'hub');

    // Upload Tier-2 (accelerate PUT fails -> regional fallback_upload succeeds)
    const t2Calls: string[] = [];
    const upTier2 = await tryDirectUploadBytes({
      serverUrl: 'https://hub.example.com',
      token: 'utok_hub',
      bytes,
      name: 'demo.png',
      mime: 'image/png',
      isPlainBrowser: false,
      fetchImpl: (async (input: RequestInfo | URL) => {
        const u = String(input);
        t2Calls.push(u);
        if (u.endsWith('/api/uploads/presign')) {
          return Response.json({
            ok: true,
            mode: 'direct',
            provider: 's3',
            file_id: 'tier2app1234567890abcdef12345678',
            skip_upload: false,
            upload: { method: 'PUT', url: 'https://b.s3-accelerate.amazonaws.com/k', headers: {} },
            fallback_upload: { method: 'PUT', url: 'https://b.s3.us-west-1.amazonaws.com/k', headers: {} },
          });
        }
        if (u.includes('s3-accelerate')) throw new Error('edge timeout');
        if (u.includes('s3.us-west-1')) return new Response('', { status: 200 });
        if (u.endsWith('/api/uploads/complete')) {
          return Response.json({ ok: true, file_id: 'tier2app1234567890abcdef12345678', url: '/api/files/tier2app1234567890abcdef12345678', size: bytes.byteLength, mime: 'image/png' });
        }
        return new Response('', { status: 404 });
      }) as typeof fetch,
    });
    ck('Upload Tier-2: retries regional fallback_upload when accelerate PUT fails', upTier2.kind === 'uploaded' && t2Calls.length === 4);

    // Upload Tier-3: <=12MiB direct PUT failure degrades cleanly to Hub /api/upload even on Desktop/Native
    const upTier3 = await tryDirectUploadBytes({
      serverUrl: 'https://hub.example.com',
      token: 'utok_hub',
      bytes,
      name: 'small.png',
      mime: 'image/png',
      isPlainBrowser: false,
      fetchImpl: (async (input: RequestInfo | URL) => {
        const u = String(input);
        if (u.endsWith('/api/uploads/presign')) {
          return Response.json({
            ok: true,
            mode: 'direct',
            provider: 's3',
            file_id: 'tier3app1234567890abcdef12345678',
            skip_upload: false,
            upload: { method: 'PUT', url: 'https://b.s3-accelerate.amazonaws.com/k', headers: {} },
          });
        }
        throw new Error('network unreachable');
      }) as typeof fetch,
    });
    ck('Upload Tier-3: <=12MiB direct network error degrades to Hub fallback', upTier3.kind === 'fallback_hub' && upTier3.degradedFallback === true);

    // P1 regression: Native iOS/Android Tier-1 503 -> Tier-2 200 MUST proceed to /api/uploads/complete!
    const nativeSteps: string[] = [];
    const nativeTier2 = await tryNativeDirectUpload({
      serverUrl: 'https://hub.example.com',
      token: 'utok_hub',
      name: 'big-video.mp4',
      mime: 'video/mp4',
      size: HUB_LOCAL_FALLBACK_MAX_BYTES + 1024 * 1024,
      timeoutMessage: 'timeout',
      fetchImpl: (async (input: RequestInfo | URL) => {
        const u = String(input);
        nativeSteps.push(u);
        if (u.endsWith('/api/uploads/presign')) {
          return Response.json({
            ok: true,
            mode: 'direct',
            provider: 's3',
            file_id: 'nativetier21234567890abcdef12345',
            skip_upload: false,
            upload: { method: 'PUT', url: 'https://b.s3-accelerate.amazonaws.com/k', headers: {} },
            fallback_upload: { method: 'PUT', url: 'https://b.s3.us-west-1.amazonaws.com/k', headers: {} },
          });
        }
        if (u.endsWith('/api/uploads/complete')) {
          return Response.json({
            ok: true,
            file_id: 'nativetier21234567890abcdef12345',
            url: '/api/files/nativetier21234567890abcdef12345',
            size: HUB_LOCAL_FALLBACK_MAX_BYTES + 1024 * 1024,
            mime: 'video/mp4',
          });
        }
        return new Response('', { status: 404 });
      }) as typeof fetch,
      putFile: async (url) => {
        nativeSteps.push(`PUT ${url}`);
        return url.includes('s3-accelerate') ? { status: 503 } : { status: 200 };
      },
    });
    ck(
      'Native iOS/Android P1: Tier-1 503 -> Tier-2 200 clears error and completes upload',
      nativeTier2.kind === 'uploaded' && nativeSteps.length === 4 && nativeSteps[3].endsWith('/api/uploads/complete'),
    );

    // P2 regression: >12MiB in plain browser NEVER falls back to Hub /api/upload on 503 or Cookie restriction
    const oversizeBytes = new Uint8Array(HUB_LOCAL_FALLBACK_MAX_BYTES + 1);
    const browserOversize503 = await tryDirectUploadBytes({
      serverUrl: 'https://hub.example.com',
      token: 'utok_hub',
      bytes: oversizeBytes,
      name: '13mb.mp4',
      mime: 'video/mp4',
      isPlainBrowser: true,
      fetchImpl: (async (input: RequestInfo | URL) => {
        const u = String(input);
        if (u.endsWith('/api/uploads/presign')) {
          return Response.json({
            ok: true,
            mode: 'direct',
            provider: 's3',
            file_id: 'oversize1234567890abcdef12345678',
            skip_upload: false,
            upload: { method: 'PUT', url: 'https://b.s3-accelerate.amazonaws.com/k', headers: {} },
          });
        }
        return new Response('unavailable', { status: 503 });
      }) as typeof fetch,
    });
    ck('Plain browser P2: >12MiB direct 503 returns real error (no Hub 413 fallback)', browserOversize503.kind === 'error' && browserOversize503.error === 'storage_put_503');

    const browserOversizeCookie = await tryDirectUploadBytes({
      serverUrl: 'https://hub.example.com',
      token: 'utok_hub',
      bytes: oversizeBytes,
      name: '13mb-ms.mp4',
      mime: 'video/mp4',
      isPlainBrowser: true,
      fetchImpl: (async () => Response.json({
        ok: true,
        mode: 'direct',
        provider: 'modelscope',
        file_id: 'oversizecookie1234567890abcdef12',
        skip_upload: false,
        upload: { method: 'PUT', url: 'https://www.modelscope.cn/lfs/k', headers: { Cookie: 'm_session_id=x' } },
      })) as typeof fetch,
    });
    ck('Plain browser P2: >12MiB Cookie restriction returns clear error (no Hub 413 fallback)', browserOversizeCookie.kind === 'error' && browserOversizeCookie.error === 'browser_cookie_forbidden');

    // P2 regression: presign 502 on >12MiB returns real 502 error instead of falling into Hub 413 (both Web/Desktop & Native)
    const webPresign502 = await tryDirectUploadBytes({
      serverUrl: 'https://hub.example.com',
      token: 'utok_hub',
      bytes: oversizeBytes,
      name: '13mb-presign.mp4',
      mime: 'video/mp4',
      isPlainBrowser: false,
      fetchImpl: (async () => Response.json({ ok: false, error: 'storage_presign_failed', message: 'LFS upstream 502' }, { status: 502 })) as typeof fetch,
    });
    ck('Web/Desktop P2: >12MiB presign 502 returns real error (no Hub 413 fallback)', webPresign502.kind === 'error' && webPresign502.error === 'storage_presign_failed');

    const nativePresign502 = await tryNativeDirectUpload({
      serverUrl: 'https://hub.example.com',
      token: 'utok_hub',
      name: '13mb-native.mp4',
      mime: 'video/mp4',
      size: HUB_LOCAL_FALLBACK_MAX_BYTES + 1,
      timeoutMessage: 'timeout',
      fetchImpl: (async () => Response.json({ ok: false, error: 'storage_presign_failed', message: 'LFS upstream 502' }, { status: 502 })) as typeof fetch,
      putFile: async () => ({ status: 200 }),
    });
    ck('Native P2: >12MiB presign 502 returns real error (no Hub 413 fallback)', nativePresign502.kind === 'error' && nativePresign502.error === 'storage_presign_failed');

    // Download 3-tier cascade on desktop-download: primary -> fallback_url -> Hub ?proxy=1
    const dlCalls: string[] = [];
    const dlOut = await downloadAuthedBytes(
      (async (input: RequestInfo | URL) => {
        const u = String(input);
        dlCalls.push(u);
        if (u.endsWith('/direct')) {
          return Response.json({
            ok: true,
            mode: 'direct',
            provider: 's3',
            url: 'https://b.s3-accelerate.amazonaws.com/k',
            fallback_url: 'https://b.s3.us-west-1.amazonaws.com/k',
            headers: {},
          });
        }
        if (u.includes('s3-accelerate')) throw new Error('edge fail');
        if (u.includes('s3.us-west-1')) return new Response('err', { status: 503 });
        if (u === appendHubProxyParam('https://hub.test/api/files/abcdef1234567890')) {
          return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength) } });
        }
        return new Response('', { status: 404 });
      }) as typeof fetch,
      'https://hub.test/api/files/abcdef1234567890',
      'utok_hub',
    );
    ck('Desktop download cascades primary -> regional fallback -> Hub ?proxy=1', dlOut.byteLength === bytes.byteLength && dlCalls.length === 4 && dlCalls[3].endsWith('?proxy=1'));

    // Native iOS/Android downloadAttachmentWith 3-tier cascade: primary -> fallbackUrl -> Hub ?proxy=1
    const nativeUrls: string[] = [];
    const memFiles = new Map<string, string>();
    const fakeFs: DownloadFs = {
      async getInfoAsync(uri) {
        const v = memFiles.get(uri);
        return v !== undefined ? { exists: true, size: v.length } : { exists: false };
      },
      async downloadAsync(url, dest) {
        nativeUrls.push(url);
        if (url.includes('s3-accelerate')) throw new Error('tls reset');
        if (url.includes('s3.us-west-1')) {
          memFiles.set(dest, 'bad');
          return { status: 503 };
        }
        memFiles.set(dest, 'native-ok-bytes');
        return { status: 200, headers: { 'content-length': '15' } };
      },
      async deleteAsync(uri) { memFiles.delete(uri); },
      async moveAsync({ from, to }) {
        const v = memFiles.get(from);
        if (v !== undefined) { memFiles.set(to, v); memFiles.delete(from); }
      },
      async readAsStringAsync(uri) { return memFiles.get(uri) ?? ''; },
      async readDirectoryAsync() { return []; },
      async writeAsStringAsync(uri, contents) { memFiles.set(uri, contents); },
    };
    const landed = await downloadAttachmentWith(
      fakeFs,
      '/cache/',
      'https://hub.test',
      'utok_hub',
      'nativefb12345678',
      'pic.png',
      'image/png',
      undefined,
      async () => ({
        url: 'https://b.s3-accelerate.amazonaws.com/k',
        fallbackUrl: 'https://b.s3.us-west-1.amazonaws.com/k',
        headers: {},
      }),
    );
    ck('Native iOS/Android downloadAttachmentWith cascades primary -> regional -> Hub ?proxy=1', landed.includes('nativefb12345678') && nativeUrls.length === 3 && nativeUrls[2] === 'https://hub.test/api/files/nativefb12345678?proxy=1');
  }

  console.log('# 5 Security & wiring contracts');
  {
    for (const f of ['src/hub-storage.ts', 'src/HubStorageSettingsCard.tsx', 'src/direct-storage.ts']) {
      ck(`${f} has zero console.* logging`, !/\bconsole\.(log|info|warn|error|debug)\s*\(/.test(read(f)));
    }
    const appSrc = read('App.tsx');
    ck('App.tsx wires setActiveHubStorageConfig and refreshHubStorageConfig', appSrc.includes('setActiveHubStorageConfig(cfg)') && appSrc.includes('refreshHubStorageConfig(cfg)'));
    const settingsSrc = read('src/SettingsScreen.tsx');
    ck('SettingsScreen renders HubStorageSettingsCard', settingsSrc.includes('<HubStorageSettingsCard />'));
    const phoneSrc = read('src/SettingsPhonePages.tsx');
    ck('SettingsPhonePages wires HubStoragePhoneGroup and HubStorageEditPage', phoneSrc.includes('<HubStoragePhoneGroup') && phoneSrc.includes('<HubStorageEditPage />'));
    const cardSrc = read('src/HubStorageSettingsCard.tsx');
    ck('HubStorageSettingsCard removes public_base_url input (strict private-only)', !cardSrc.includes('hub-storage-public-url') && !cardSrc.includes('publicUrlLabel'));

    // Guard against directional words (下面/below) in footer strings
    let badFooter = false;
    for (const lang of ['zh', 'en'] as const) {
      setLanguagePreference(lang);
      for (const k of ['hubStorage.adminFooter', 'hubStorage.memberFooterEnabled', 'hubStorage.memberFooterDisabled', 'hubStorage.vaultMissing', 'hubStorage.phoneHint']) {
        if (/下面|下方|以下|below/i.test(t(k))) badFooter = true;
      }
    }
    setLanguagePreference('zh');
    ck('No footer copy uses forbidden directional words (下面/below)', !badFooter);
  }

  console.log(`\nhub-storage: ${pass}/${total} passed`);
  if (pass !== total) process.exit(1);
};

void run();
