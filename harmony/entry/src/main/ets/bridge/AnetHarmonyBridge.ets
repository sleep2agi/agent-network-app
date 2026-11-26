import { common, wantConstant } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { webview } from '@kit.ArkWeb';
import { rcp } from '@kit.RemoteCommunicationKit';
import { http } from '@kit.NetworkKit';
import { preferences } from '@kit.ArkData';
import { fileIo, fileUri, picker } from '@kit.CoreFileKit';
import { filePreview } from '@kit.PreviewKit';
import { notificationManager } from '@kit.NotificationKit';
import { BusinessError, pasteboard } from '@kit.BasicServicesKit';
import { util } from '@kit.ArkTS';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN = 0x0000;
const TAG = 'ANetBridge';

interface BridgeHttpRequest {
  method?: string;
  url?: string;
  headers?: Array<Array<string>>;
  bodyBase64?: string | null;
  timeoutMs?: number;
}

interface BridgeHttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  headers: Array<Array<string>>;
  bodyBase64: string | null;
  error?: string;
}

interface BridgeSseRequest {
  url?: string;
  headers?: Array<Array<string>>;
}

interface BridgeFileDownloadRequest {
  url?: string;
  token?: string;
  fileName?: string;
  mimeType?: string;
  mode?: string;
}

interface BridgeFileOpenRequest {
  path?: string;
  fileName?: string;
  mimeType?: string;
}

interface BridgeFileResult {
  ok: boolean;
  path?: string;
  error?: string;
}

interface BridgeNotifyRequest {
  id?: number;
  title?: string;
  body?: string;
}

interface BridgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function escapeJsString(raw: string): string {
  return JSON.stringify(raw).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function sanitizeFileName(raw: string): string {
  const base = (raw || 'download.bin').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  if (!base || base === '.' || base === '..') return 'download.bin';
  return base.length > 120 ? base.slice(0, 120) : base;
}

function toRcpMethod(raw: string): rcp.HttpMethod {
  switch (raw.toUpperCase()) {
    case 'POST':
      return 'POST';
    case 'PUT':
      return 'PUT';
    case 'PATCH':
      return 'PATCH';
    case 'DELETE':
      return 'DELETE';
    case 'HEAD':
      return 'HEAD';
    case 'OPTIONS':
      return 'OPTIONS';
    default:
      return 'GET';
  }
}

export class AnetHarmonyBridge {
  private session: rcp.Session | null = null;
  private controller: webview.WebviewController | null = null;
  private hostContext: common.UIAbilityContext | null = null;
  private base64: util.Base64Helper = new util.Base64Helper();
  private sseClients: Map<string, http.HttpRequest> = new Map<string, http.HttpRequest>();

  attachController(ctrl: webview.WebviewController): void {
    this.controller = ctrl;
  }

  attachHostContext(ctx: common.UIAbilityContext): void {
    this.hostContext = ctx;
  }

  private ensureSession(): rcp.Session {
    if (!this.session) {
      try {
        this.session = rcp.createSession({
          requestConfiguration: {
            transfer: {
              timeout: {
                connectMs: 12000,
                transferMs: 25000,
              },
            },
          },
        });
      } catch (err) {
        const e = err as BusinessError;
        hilog.error(DOMAIN, TAG, 'rcp.createSession failed: %{public}s', e?.message ?? String(err));
        throw new Error(e?.message ?? String(err));
      }
    }
    return this.session;
  }

  private evalJs(script: string, label: string): void {
    const ctrl = this.controller;
    if (!ctrl) {
      hilog.warn(DOMAIN, TAG, '%{public}s dropped: controller not attached', label);
      return;
    }
    try {
      ctrl.runJavaScript(script).catch((err: BusinessError) => {
        hilog.warn(DOMAIN, TAG, '%{public}s runJavaScript failed: %{public}s', label, err?.message ?? String(err));
      });
    } catch (err) {
      const e = err as BusinessError;
      hilog.warn(DOMAIN, TAG, '%{public}s runJavaScript threw: %{public}s', label, e?.message ?? String(err));
    }
  }

  /**
   * ArkWeb `javaScriptProxy` `asyncMethodList` does not return values directly to JS.
   * Execute the native RCP request asynchronously and push the serialized response back
   * to the WebView via `window.__ANET_HARMONY_HTTP_RESOLVE__(reqId, rawJson)`.
   */
  httpFetchAsync(reqId: string, reqJson: string): void {
    this.httpFetch(reqJson).then((resJson: string) => {
      const script =
        `if(typeof window.__ANET_HARMONY_HTTP_RESOLVE__==='function'){` +
        `window.__ANET_HARMONY_HTTP_RESOLVE__(${escapeJsString(reqId)},${escapeJsString(resJson)});}`;
      this.evalJs(script, 'httpFetchAsync');
    }).catch((err: BusinessError) => {
      hilog.warn(DOMAIN, TAG, 'httpFetchAsync unexpected error: %{public}s', err?.message ?? String(err));
    });
  }

  async httpFetch(reqJson: string): Promise<string> {
    let parsed: BridgeHttpRequest;
    try {
      parsed = JSON.parse(reqJson) as BridgeHttpRequest;
    } catch {
      const bad: BridgeHttpResponse = {
        ok: false,
        status: 0,
        statusText: '',
        url: '',
        headers: [],
        bodyBase64: null,
        error: 'Malformed request JSON',
      };
      return JSON.stringify(bad);
    }

    const url: string = parsed.url ?? '';
    const method: rcp.HttpMethod = toRcpMethod(parsed.method ?? 'GET');
    const reqHeaders: rcp.RequestHeaders = {};
    if (parsed.headers) {
      for (let i = 0; i < parsed.headers.length; i++) {
        const pair = parsed.headers[i];
        if (pair && pair.length >= 2) {
          reqHeaders[pair[0]] = pair[1];
        }
      }
    }

    let content: ArrayBuffer | undefined = undefined;
    if (parsed.bodyBase64 && parsed.bodyBase64.length > 0) {
      const decoded: Uint8Array = this.base64.decodeSync(parsed.bodyBase64);
      content = decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength);
    }

    try {
      const req = new rcp.Request(url, method, reqHeaders, content);
      const res: rcp.Response = await this.ensureSession().fetch(req);
      const outHeaders: Array<Array<string>> = [];
      if (res.headers) {
        const rawHeaders: rcp.ResponseHeaders = res.headers;
        const keys: Array<string> = Object.keys(rawHeaders);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          if (!k || k.startsWith(':')) continue;
          const v: string | Array<string> | undefined = rawHeaders[k];
          if (v === undefined || v === null) continue;
          if (Array.isArray(v)) {
            for (let j = 0; j < v.length; j++) {
              outHeaders.push([k, v[j]]);
            }
          } else {
            outHeaders.push([k, v]);
          }
        }
      }

      let bodyBase64: string | null = null;
      if (res.body && res.body.byteLength > 0) {
        bodyBase64 = this.base64.encodeToStringSync(new Uint8Array(res.body));
      }

      const payload: BridgeHttpResponse = {
        ok: true,
        status: res.statusCode,
        statusText: '',
        url: res.effectiveUrl ? res.effectiveUrl.toString() : url,
        headers: outHeaders,
        bodyBase64: bodyBase64,
      };
      return JSON.stringify(payload);
    } catch (err) {
      const e = err as BusinessError;
      const msg = e && e.message ? `${e.message} (${e.code ?? ''})` : String(err);
      hilog.warn(DOMAIN, TAG, 'httpFetch failed for %{public}s: %{public}s', url, msg);
      const failed: BridgeHttpResponse = {
        ok: false,
        status: 0,
        statusText: '',
        url: url,
        headers: [],
        bodyBase64: null,
        error: msg,
      };
      return JSON.stringify(failed);
    }
  }

  // ── Native SSE stream (bypasses ArkWeb CORS for /events/users/me & /events/network/*) ──

  private pushSse(streamId: string, kind: string, data: string): void {
    const script =
      `if(typeof window.__ANET_HARMONY_SSE_EVENT__==='function'){` +
      `window.__ANET_HARMONY_SSE_EVENT__(${escapeJsString(streamId)},${escapeJsString(kind)},${escapeJsString(data)});}`;
    this.evalJs(script, 'sse');
  }

  openSseStream(streamId: string, reqJson: string): void {
    this.closeSseStream(streamId);
    let parsed: BridgeSseRequest;
    try {
      parsed = JSON.parse(reqJson) as BridgeSseRequest;
    } catch {
      this.pushSse(streamId, 'error', 'Malformed SSE request JSON');
      return;
    }
    const url = parsed.url ?? '';
    if (!/^https?:\/\/\S+$/i.test(url)) {
      this.pushSse(streamId, 'error', 'Invalid SSE URL');
      return;
    }

    const reqHeaders: Record<string, string> = {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
    };
    if (parsed.headers) {
      for (let i = 0; i < parsed.headers.length; i++) {
        const pair = parsed.headers[i];
        if (pair && pair.length >= 2 && pair[0]) {
          reqHeaders[pair[0]] = pair[1];
        }
      }
    }

    const client = http.createHttp();
    this.sseClients.set(streamId, client);
    const decoder = util.TextDecoder.create('utf-8', { ignoreBOM: true });
    let opened = false;
    let closedByCaller = false;

    const cleanup = (): void => {
      try { client.off('headersReceive'); } catch { /* ignore */ }
      try { client.off('dataReceive'); } catch { /* ignore */ }
      try { client.off('dataEnd'); } catch { /* ignore */ }
      try { client.destroy(); } catch { /* ignore */ }
      if (this.sseClients.get(streamId) === client) {
        this.sseClients.delete(streamId);
      }
    };

    client.on('headersReceive', (header: Object) => {
      if (this.sseClients.get(streamId) !== client) return;
      const map = header as Record<string, Object>;
      const statusRaw = map[':status'];
      if (statusRaw !== undefined && String(statusRaw) !== '200') return;
      if (!opened) {
        opened = true;
        this.pushSse(streamId, 'open', '');
      }
    });

    client.on('dataReceive', (data: ArrayBuffer) => {
      if (this.sseClients.get(streamId) !== client) return;
      if (!opened) {
        opened = true;
        this.pushSse(streamId, 'open', '');
      }
      if (!data || data.byteLength === 0) return;
      try {
        const text = decoder.decodeToString(new Uint8Array(data), { stream: true });
        if (text.length > 0) {
          this.pushSse(streamId, 'chunk', text);
        }
      } catch (err) {
        const e = err as BusinessError;
        hilog.warn(DOMAIN, TAG, 'SSE decode error: %{public}s', e?.message ?? String(err));
      }
    });

    const options: http.HttpRequestOptions = {
      method: http.RequestMethod.GET,
      header: reqHeaders,
      connectTimeout: 15000,
      readTimeout: 300000,
    };

    client.requestInStream(url, options).then((statusCode: number) => {
      closedByCaller = this.sseClients.get(streamId) !== client;
      cleanup();
      if (closedByCaller) return;
      const reason = statusCode !== 200 ? `HTTP ${statusCode}` : 'server closed stream';
      this.pushSse(streamId, 'close', reason);
    }).catch((err: BusinessError) => {
      closedByCaller = this.sseClients.get(streamId) !== client;
      cleanup();
      if (closedByCaller) return;
      const msg = err && err.message ? `${err.message} (${err.code ?? ''})` : String(err);
      hilog.warn(DOMAIN, TAG, 'SSE stream error for %{public}s: %{public}s', url, msg);
      this.pushSse(streamId, 'error', msg);
    });
  }

  closeSseStream(streamId: string): void {
    const existing = this.sseClients.get(streamId);
    if (!existing) return;
    this.sseClients.delete(streamId);
    try { existing.off('headersReceive'); } catch { /* ignore */ }
    try { existing.off('dataReceive'); } catch { /* ignore */ }
    try { existing.off('dataEnd'); } catch { /* ignore */ }
    try { existing.destroy(); } catch { /* ignore */ }
  }

  // ── Native File Download / Save / Preview (zero JS Base64 OOM) ──

  private pushFileResult(reqId: string, result: BridgeFileResult): void {
    const script =
      `if(typeof window.__ANET_HARMONY_FILE_RESOLVE__==='function'){` +
      `window.__ANET_HARMONY_FILE_RESOLVE__(${escapeJsString(reqId)},${escapeJsString(JSON.stringify(result))});}`;
    this.evalJs(script, 'fileResult');
  }

  downloadAndOpenFileAsync(reqId: string, reqJson: string): void {
    this.runFileDownload(reqJson).then((res: BridgeFileResult) => {
      this.pushFileResult(reqId, res);
    }).catch((err: BusinessError) => {
      this.pushFileResult(reqId, { ok: false, error: err?.message ?? String(err) });
    });
  }

  openLocalFileAsync(reqId: string, reqJson: string): void {
    this.runOpenLocalFile(reqJson).then((res: BridgeFileResult) => {
      this.pushFileResult(reqId, res);
    }).catch((err: BusinessError) => {
      this.pushFileResult(reqId, { ok: false, error: err?.message ?? String(err) });
    });
  }

  private async runFileDownload(reqJson: string): Promise<BridgeFileResult> {
    const hostCtx = this.hostContext;
    if (!hostCtx) return { ok: false, error: 'Host context unavailable' };
    let parsed: BridgeFileDownloadRequest;
    try {
      parsed = JSON.parse(reqJson) as BridgeFileDownloadRequest;
    } catch {
      return { ok: false, error: 'Malformed file request JSON' };
    }
    const url = parsed.url ?? '';
    if (!/^https?:\/\/\S+$/i.test(url)) return { ok: false, error: 'Invalid download URL' };
    const safeName = sanitizeFileName(parsed.fileName ?? 'download.bin');
    const mimeType = (parsed.mimeType && parsed.mimeType.trim()) ? parsed.mimeType.trim() : '*/*';
    const mode = parsed.mode === 'save' ? 'save' : 'open';

    const reqHeaders: rcp.RequestHeaders = {};
    if (parsed.token && parsed.token.length > 0) {
      reqHeaders['Authorization'] = `Bearer ${parsed.token}`;
    }

    const req = new rcp.Request(url, 'GET', reqHeaders);
    const res: rcp.Response = await this.ensureSession().fetch(req);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return { ok: false, error: `HTTP ${res.statusCode}` };
    }

    const dir = `${hostCtx.cacheDir}/downloads`;
    try {
      if (!fileIo.accessSync(dir)) {
        fileIo.mkdirSync(dir, true);
      }
    } catch {
      try { fileIo.mkdirSync(dir, true); } catch { /* exists */ }
    }
    const localPath = `${dir}/${Date.now()}_${safeName}`;
    const file = fileIo.openSync(localPath, fileIo.OpenMode.CREATE | fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.TRUNC);
    try {
      if (res.body && res.body.byteLength > 0) {
        fileIo.writeSync(file.fd, res.body);
      }
    } finally {
      fileIo.closeSync(file);
    }

    if (mode === 'save') {
      const savePicker = new picker.DocumentViewPicker(hostCtx);
      const saveOpts = new picker.DocumentSaveOptions();
      saveOpts.newFileNames = [safeName];
      const uris: Array<string> = await savePicker.save(saveOpts);
      if (!uris || uris.length === 0) {
        return { ok: true, path: localPath };
      }
      const dstFile = fileIo.openSync(uris[0], fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC);
      try {
        fileIo.copyFileSync(localPath, dstFile.fd);
      } finally {
        fileIo.closeSync(dstFile);
      }
      return { ok: true, path: uris[0] };
    }

    await this.openUriWithPreviewOrAbility(hostCtx, localPath, safeName, mimeType);
    return { ok: true, path: localPath };
  }

  private async runOpenLocalFile(reqJson: string): Promise<BridgeFileResult> {
    const hostCtx = this.hostContext;
    if (!hostCtx) return { ok: false, error: 'Host context unavailable' };
    let parsed: BridgeFileOpenRequest;
    try {
      parsed = JSON.parse(reqJson) as BridgeFileOpenRequest;
    } catch {
      return { ok: false, error: 'Malformed open request JSON' };
    }
    const localPath = parsed.path ?? '';
    if (!localPath) return { ok: false, error: 'Empty file path' };
    const safeName = sanitizeFileName(parsed.fileName ?? 'file');
    const mimeType = (parsed.mimeType && parsed.mimeType.trim()) ? parsed.mimeType.trim() : '*/*';
    await this.openUriWithPreviewOrAbility(hostCtx, localPath, safeName, mimeType);
    return { ok: true, path: localPath };
  }

  private async openUriWithPreviewOrAbility(
    hostCtx: common.UIAbilityContext,
    localPathOrUri: string,
    title: string,
    mimeType: string,
  ): Promise<void> {
    const uri = localPathOrUri.startsWith('file://') ? localPathOrUri : fileUri.getUriFromPath(localPathOrUri);
    try {
      const can = await filePreview.canPreview(hostCtx, uri);
      if (can) {
        const info: filePreview.PreviewInfo = {
          title: title,
          uri: uri,
          mimeType: mimeType,
        };
        await filePreview.openPreview(hostCtx, info);
        return;
      }
    } catch (err) {
      const e = err as BusinessError;
      hilog.warn(DOMAIN, TAG, 'PreviewKit fallback to startAbility: %{public}s', e?.message ?? String(err));
    }
    await hostCtx.startAbility({
      action: 'ohos.want.action.viewData',
      uri: uri,
      type: mimeType,
      flags: wantConstant.Flags.FLAG_AUTH_READ_URI_PERMISSION,
    });
  }

  // ── External Links ──

  openExternalUrl(url: string): boolean {
    const trimmed = url ? url.trim() : '';
    if (!/^https?:\/\/\S+$/i.test(trimmed)) return false;
    const hostCtx = this.hostContext;
    if (!hostCtx) return false;
    try {
      hostCtx.startAbility({
        action: 'ohos.want.action.viewData',
        entities: ['entity.system.browsable'],
        uri: trimmed,
      }).catch((err: BusinessError) => {
        hilog.warn(DOMAIN, TAG, 'openExternalUrl failed: %{public}s', err?.message ?? String(err));
      });
      return true;
    } catch (err) {
      const e = err as BusinessError;
      hilog.warn(DOMAIN, TAG, 'openExternalUrl threw: %{public}s', e?.message ?? String(err));
      return false;
    }
  }

  // ── Theme & System Bar Sync ──

  setThemeMode(mode: string): void {
    const isDark = mode === 'dark';
    AppStorage.setOrCreate<string>('anetThemeMode', isDark ? 'dark' : 'light');
    const win = AppStorage.get<window.Window>('anetMainWindow');
    if (!win) return;
    try {
      const props: window.SystemBarProperties = {
        statusBarColor: '#00000000',
        statusBarContentColor: isDark ? '#FFFFFF' : '#1D2026',
        navigationBarColor: '#00000000',
        navigationBarContentColor: isDark ? '#FFFFFF' : '#1D2026',
      };
      win.setWindowSystemBarProperties(props).catch((err: BusinessError) => {
        hilog.warn(DOMAIN, TAG, 'setThemeMode system bar failed: %{public}s', err?.message ?? String(err));
      });
    } catch (err) {
      const e = err as BusinessError;
      hilog.warn(DOMAIN, TAG, 'setThemeMode threw: %{public}s', e?.message ?? String(err));
    }
  }

  // ── Native Notifications (@kit.NotificationKit) ──

  requestNotificationPermission(): void {
    const hostCtx = this.hostContext;
    try {
      if (hostCtx) {
        notificationManager.requestEnableNotification(hostCtx).catch((err: BusinessError) => {
          hilog.warn(DOMAIN, TAG, 'requestEnableNotification failed: %{public}s', err?.message ?? String(err));
        });
      }
    } catch (err) {
      const e = err as BusinessError;
      hilog.warn(DOMAIN, TAG, 'requestEnableNotification threw: %{public}s', e?.message ?? String(err));
    }
  }

  postNotification(payloadJson: string): void {
    let parsed: BridgeNotifyRequest;
    try {
      parsed = JSON.parse(payloadJson) as BridgeNotifyRequest;
    } catch {
      return;
    }
    const idNum = typeof parsed.id === 'number' && Number.isFinite(parsed.id) ? Math.abs(Math.floor(parsed.id)) : 1;
    const title = parsed.title ?? 'ANet';
    const body = parsed.body ?? '';
    const req: notificationManager.NotificationRequest = {
      id: idNum > 0 ? idNum : 1,
      notificationSlotType: notificationManager.SlotType.SOCIAL_COMMUNICATION,
      content: {
        notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
        normal: {
          title: title,
          text: body,
        },
      },
    };
    try {
      notificationManager.publish(req).catch((err: BusinessError) => {
        hilog.warn(DOMAIN, TAG, 'notificationManager.publish failed: %{public}s', err?.message ?? String(err));
      });
    } catch (err) {
      const e = err as BusinessError;
      hilog.warn(DOMAIN, TAG, 'notificationManager.publish threw: %{public}s', e?.message ?? String(err));
    }
  }

  cancelNotification(idNum: number): void {
    const cleanId = Math.abs(Math.floor(idNum));
    if (cleanId <= 0) return;
    try {
      notificationManager.cancel(cleanId).catch(() => {});
    } catch {
      // ignore
    }
  }

  // ── Native KV Persistence ──

  private kvStore(): preferences.Preferences | null {
    const pref = AppStorage.get<preferences.Preferences>('anetKvStore');
    return pref ?? null;
  }

  kvGet(key: string): string | null {
    const store = this.kvStore();
    if (!store) return null;
    try {
      const val = store.getSync(key, '');
      const text = String(val);
      return text.length > 0 ? text : null;
    } catch {
      return null;
    }
  }

  kvSet(key: string, value: string): void {
    const store = this.kvStore();
    if (!store) return;
    try {
      store.putSync(key, value);
      store.flush().catch(() => {});
    } catch (err) {
      const e = err as BusinessError;
      hilog.warn(DOMAIN, TAG, 'kvSet failed: %{public}s', e.message);
    }
  }

  kvDel(key: string): void {
    const store = this.kvStore();
    if (!store) return;
    try {
      store.deleteSync(key);
      store.flush().catch(() => {});
    } catch (err) {
      const e = err as BusinessError;
      hilog.warn(DOMAIN, TAG, 'kvDel failed: %{public}s', e.message);
    }
  }

  getInsetsJson(): string {
    const insets: BridgeInsets = {
      top: AppStorage.get<number>('anetInsetTop') ?? 0,
      right: AppStorage.get<number>('anetInsetRight') ?? 0,
      bottom: AppStorage.get<number>('anetInsetBottom') ?? 0,
      left: AppStorage.get<number>('anetInsetLeft') ?? 0,
    };
    return JSON.stringify(insets);
  }

  copyText(text: string): void {
    try {
      const data = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
      pasteboard.getSystemPasteboard().setData(data).catch(() => {});
    } catch (err) {
      const e = err as BusinessError;
      hilog.warn(DOMAIN, TAG, 'copyText failed: %{public}s', e.message);
    }
  }
}
