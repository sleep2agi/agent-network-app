import { webview } from '@kit.ArkWeb';
import { http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';
import { common } from '@kit.AbilityKit';

// ANet 鸿蒙外壳。
// ① 界面：随包打进去的 App 网页版（rawfile/web），用一个固定的虚拟站点
//    https://app.anet.local/ 加载，请求在 onInterceptRequest 里直接从包里读 —— 不依赖网络就能打开界面，
//    `/_expo/...` 这类绝对路径也能找到。
// ② 联网：网页里直接 fetch Hub 会被浏览器的跨域规则挡住（Hub 只放行自己配置的来源）。
//    和桌面版（Tauri 原生 HTTP）同一个思路：注册 `anetHarmony.fetch`，由系统网络库发请求，
//    App 的 appFetch 检测到它就走这条路。
const APP_ORIGIN = 'https://app.anet.local';

const MIME: Record<string, string> = {
  'html': 'text/html', 'js': 'application/javascript', 'css': 'text/css', 'json': 'application/json',
  'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif', 'svg': 'image/svg+xml',
  'webp': 'image/webp', 'ico': 'image/x-icon', 'ttf': 'font/ttf', 'otf': 'font/otf', 'woff': 'font/woff',
  'woff2': 'font/woff2', 'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'mp4': 'video/mp4', 'wasm': 'application/wasm'
};

interface BridgeRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  bodyBase64?: string;
}

interface BridgeResponse {
  status: number;
  headers: Record<string, string>;
  bodyBase64: string;
  error?: string;
}

const METHODS: Record<string, http.RequestMethod> = {
  'GET': http.RequestMethod.GET, 'POST': http.RequestMethod.POST, 'PUT': http.RequestMethod.PUT,
  'DELETE': http.RequestMethod.DELETE, 'OPTIONS': http.RequestMethod.OPTIONS, 'HEAD': http.RequestMethod.HEAD
};

function bridgeResponse(status: number, headers: Record<string, string>, bodyBase64: string, error?: string): string {
  const r: BridgeResponse = { status: status, headers: headers, bodyBase64: bodyBase64, error: error };
  return JSON.stringify(r);
}

class AnetBridge {
  private b64: util.Base64Helper = new util.Base64Helper();

  fetch(reqJson: string): Promise<string> {
    return new Promise<string>((resolve) => {
      let req: BridgeRequest;
      try {
        req = JSON.parse(reqJson) as BridgeRequest;
      } catch (e) {
        resolve(bridgeResponse(0, {}, '', 'bad request'));
        return;
      }
      const client = http.createHttp();
      const method = METHODS[(req.method ?? 'GET').toUpperCase()] ?? http.RequestMethod.GET;
      const reqHeaders: Record<string, string> = req.headers ?? {};
      const options: http.HttpRequestOptions = {
        method: method,
        header: reqHeaders,
        expectDataType: http.HttpDataType.ARRAY_BUFFER,
        connectTimeout: 15000,
        readTimeout: 120000
      };
      if (req.bodyBase64) {
        const bytes = this.b64.decodeSync(req.bodyBase64);
        options.extraData = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
      client.request(req.url, options).then((res: http.HttpResponse) => {
        const headers: Record<string, string> = {};
        if (res.header) {
          const raw = res.header as Record<string, Object>;
          Object.keys(raw).forEach((k: string) => { headers[k] = String(raw[k]); });
        }
        const body = res.result instanceof ArrayBuffer ? new Uint8Array(res.result) : new Uint8Array(0);
        resolve(bridgeResponse(res.responseCode, headers, this.b64.encodeToStringSync(body)));
      }).catch((err: Error) => {
        resolve(bridgeResponse(0, {}, '', err?.message ?? String(err)));
      }).finally(() => client.destroy());
    });
  }
}

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();
  bridge: AnetBridge = new AnetBridge();

  onBackPress(): boolean {
    if (this.controller.accessBackward()) {
      this.controller.backward();
      return true;
    }
    return false;
  }

  private readRaw(path: string): Uint8Array | null {
    try {
      const ctx = getContext(this) as common.UIAbilityContext;
      return ctx.resourceManager.getRawFileContentSync('web' + path);
    } catch (e) {
      return null;
    }
  }

  private serve(url: string): WebResourceResponse | null {
    if (!url.startsWith(APP_ORIGIN + '/')) return null;
    let path = url.substring(APP_ORIGIN.length).split('?')[0].split('#')[0];
    try { path = decodeURIComponent(path); } catch (e) { /* keep raw */ }
    if (path === '/' || path === '') path = '/index.html';
    let data = this.readRaw(path);
    // 单页应用：没有扩展名的路径（路由）一律回 index.html。
    if (!data && path.lastIndexOf('.') <= path.lastIndexOf('/')) {
      path = '/index.html';
      data = this.readRaw(path);
    }
    const res = new WebResourceResponse();
    if (!data) {
      res.setResponseCode(404);
      res.setReasonMessage('Not Found');
      res.setResponseData('');
      res.setResponseIsReady(true);
      return res;
    }
    const ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase();
    res.setResponseMimeType(MIME[ext] ?? 'application/octet-stream');
    res.setResponseEncoding('utf-8');
    res.setResponseCode(200);
    res.setReasonMessage('OK');
    res.setResponseData(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    res.setResponseIsReady(true);
    return res;
  }

  build() {
    Column() {
      Web({ src: APP_ORIGIN + '/index.html', controller: this.controller })
        .domStorageAccess(true)
        .databaseAccess(true)
        .javaScriptAccess(true)
        .mediaPlayGestureAccess(false)
        .javaScriptProxy({
          object: this.bridge,
          name: 'anetHarmony',
          methodList: ['fetch'],
          controller: this.controller
        })
        .onInterceptRequest((event) => {
          // 返回 null = 不拦截（Hub 等外部地址照常走网络）。
          const r: WebResourceResponse | null = event ? this.serve(event.request.getRequestUrl()) : null;
          return r as WebResourceResponse;
        })
        .onPermissionRequest((event) => {
          // 语音输入要麦克风：系统先弹自己的授权框，这里只放行网页侧的请求。
          event?.request.grant(event.request.getAccessibleResource());
        })
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#0B1220')
  }
}
