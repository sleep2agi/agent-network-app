import { webview } from '@kit.ArkWeb';
import { rcp } from '@kit.RemoteCommunicationKit';
import { preferences } from '@kit.ArkData';
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

interface BridgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
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
  private base64: util.Base64Helper = new util.Base64Helper();

  attachController(ctrl: webview.WebviewController): void {
    this.controller = ctrl;
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

  /**
   * ArkWeb `javaScriptProxy` `asyncMethodList` does not return values directly to JS.
   * Execute the native RCP request asynchronously and push the serialized response back
   * to the WebView via `window.__ANET_HARMONY_HTTP_RESOLVE__(reqId, rawJson)`.
   */
  httpFetchAsync(reqId: string, reqJson: string): void {
    this.httpFetch(reqJson).then((resJson: string) => {
      const ctrl = this.controller;
      if (!ctrl) {
        hilog.warn(DOMAIN, TAG, 'httpFetchAsync dropped response for %{public}s: controller not attached', reqId);
        return;
      }
      const idLiteral = JSON.stringify(reqId);
      const resLiteral = JSON.stringify(resJson).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
      const script =
        `if(typeof window.__ANET_HARMONY_HTTP_RESOLVE__==='function'){` +
        `window.__ANET_HARMONY_HTTP_RESOLVE__(${idLiteral},${resLiteral});}`;
      try {
        ctrl.runJavaScript(script).catch((err: BusinessError) => {
          hilog.warn(DOMAIN, TAG, 'httpFetchAsync runJavaScript failed: %{public}s', err?.message ?? String(err));
        });
      } catch (err) {
        const e = err as BusinessError;
        hilog.warn(DOMAIN, TAG, 'httpFetchAsync runJavaScript threw: %{public}s', e?.message ?? String(err));
      }
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
