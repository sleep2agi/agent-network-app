import { abilityAccessCtrl, common } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { AnetHarmonyBridge } from '../bridge/AnetHarmonyBridge';

const DOMAIN = 0x0000;
const TAG = 'ANetIndex';
const APP_ORIGIN = 'https://anet.local/';

function mimeTypeForPath(relPath: string): string {
  const lower = relPath.toLowerCase();
  if (lower.endsWith('.html')) return 'text/html';
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'application/javascript';
  if (lower.endsWith('.css')) return 'text/css';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.ico')) return 'image/x-icon';
  if (lower.endsWith('.ttf')) return 'font/ttf';
  if (lower.endsWith('.woff')) return 'font/woff';
  if (lower.endsWith('.woff2')) return 'font/woff2';
  return 'application/octet-stream';
}

function isTextMime(mime: string): boolean {
  return mime.startsWith('text/') || mime === 'application/javascript' || mime === 'application/json' || mime === 'image/svg+xml';
}

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController();
  private bridge: AnetHarmonyBridge = new AnetHarmonyBridge();
  private pageLoaded: boolean = false;
  private allowSystemBackOnce: boolean = false;

  @StorageProp('anetInsetTop') @Watch('pushInsetsToWeb') insetTop: number = 0;
  @StorageProp('anetInsetRight') @Watch('pushInsetsToWeb') insetRight: number = 0;
  @StorageProp('anetInsetBottom') @Watch('pushInsetsToWeb') insetBottom: number = 0;
  @StorageProp('anetInsetLeft') @Watch('pushInsetsToWeb') insetLeft: number = 0;

  aboutToAppear(): void {
    this.bridge.attachController(this.controller);
  }

  private pushInsetsToWeb(): void {
    if (!this.pageLoaded) return;
    const payload = this.bridge.getInsetsJson();
    const script =
      `window.__ANET_HARMONY_INSETS__=${payload};` +
      `window.dispatchEvent(new CustomEvent('anet-harmony-insets',{detail:${payload}}));`;
    try {
      this.controller.runJavaScript(script).catch(() => {});
    } catch {
      // WebView not attached yet
    }
  }

  private resolveRawfileResponse(requestUrl: string): WebResourceResponse | null {
    if (!requestUrl.startsWith(APP_ORIGIN)) {
      return null;
    }
    let relPath = requestUrl.slice(APP_ORIGIN.length);
    const qIdx = relPath.indexOf('?');
    if (qIdx >= 0) relPath = relPath.slice(0, qIdx);
    const hIdx = relPath.indexOf('#');
    if (hIdx >= 0) relPath = relPath.slice(0, hIdx);
    if (!relPath || relPath.endsWith('/')) {
      relPath = 'index.html';
    }
    if (relPath.includes('..')) {
      return null;
    }

    const hostCtx = this.getUIContext().getHostContext();
    if (!hostCtx) {
      return null;
    }
    const resMgr = hostCtx.resourceManager;
    let rawBytes: Uint8Array | null = null;
    let targetPath = relPath;
    try {
      rawBytes = resMgr.getRawFileContentSync(`web/${targetPath}`);
    } catch {
      // SPA route fallback to web/index.html when path has no file extension
      if (!targetPath.includes('.')) {
        targetPath = 'index.html';
        try {
          rawBytes = resMgr.getRawFileContentSync('web/index.html');
        } catch (err) {
          const e = err as BusinessError;
          hilog.error(DOMAIN, TAG, 'Missing rawfile web/index.html: %{public}s', e.message);
          return null;
        }
      } else {
        return null;
      }
    }

    if (!rawBytes) {
      return null;
    }
    const mime = mimeTypeForPath(targetPath);
    const response = new WebResourceResponse();
    const buf = rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength);
    response.setResponseData(buf);
    response.setResponseMimeType(mime);
    if (isTextMime(mime)) {
      response.setResponseEncoding('utf-8');
    }
    response.setResponseCode(200);
    response.setReasonMessage('OK');
    response.setResponseIsReady(true);
    return response;
  }

  onBackPress(): boolean {
    if (this.allowSystemBackOnce) {
      this.allowSystemBackOnce = false;
      return false;
    }
    if (!this.pageLoaded) {
      return false;
    }
    this.controller.runJavaScript(
      '(function(){try{return typeof window.__ANET_HARMONY_BACK__==="function" && !!window.__ANET_HARMONY_BACK__();}catch(e){return false;}})()'
    ).then((result: string) => {
      if (result !== 'true') {
        if (this.controller.accessBackward()) {
          this.controller.backward();
        } else {
          try {
            const abilityCtx = this.getUIContext().getHostContext() as common.UIAbilityContext | undefined;
            if (abilityCtx) {
              abilityCtx.moveAbilityToBackground().catch(() => {
                this.allowSystemBackOnce = true;
              });
            } else {
              this.allowSystemBackOnce = true;
            }
          } catch {
            this.allowSystemBackOnce = true;
          }
        }
      }
    }).catch(() => {});
    return true;
  }

  build() {
    Column() {
      Web({ src: `${APP_ORIGIN}index.html`, controller: this.controller })
        .width('100%')
        .height('100%')
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .fileAccess(true)
        .imageAccess(true)
        .onlineImageAccess(true)
        .mixedMode(MixedMode.All)
        .keyboardAvoidMode(WebKeyboardAvoidMode.RESIZE_CONTENT)
        .javaScriptProxy({
          object: this.bridge,
          name: '__ANET_HARMONY__',
          methodList: ['kvGet', 'kvSet', 'kvDel', 'getInsetsJson', 'copyText'],
          asyncMethodList: ['httpFetchAsync'],
          controller: this.controller,
        })
        .onControllerAttached(() => {
          this.bridge.attachController(this.controller);
          try {
            const ua = this.controller.getUserAgent();
            if (!ua.includes('ANetHarmony')) {
              this.controller.setCustomUserAgent(`${ua} ANetHarmony/1.0`);
            }
          } catch (err) {
            const e = err as BusinessError;
            hilog.warn(DOMAIN, TAG, 'setCustomUserAgent skipped: %{public}s', e.message);
          }
        })
        .onInterceptRequest((event) => {
          if (!event) return null;
          return this.resolveRawfileResponse(event.request.getRequestUrl());
        })
        .onPermissionRequest((event) => {
          // 语音输入需要麦克风：先触发系统权限弹窗，用户授权后再放行 ArkWeb 网页侧录音请求。
          if (!event) return;
          const req = event.request;
          const resources = req.getAccessibleResource();
          const hostCtx = this.getUIContext().getHostContext() as common.UIAbilityContext | undefined;
          if (hostCtx) {
            try {
              const atManager = abilityAccessCtrl.createAtManager();
              atManager.requestPermissionsFromUser(hostCtx, ['ohos.permission.MICROPHONE'])
                .then((res) => {
                  if (res.authResults && res.authResults.length > 0 && res.authResults[0] === 0) {
                    req.grant(resources);
                  } else {
                    req.deny();
                  }
                })
                .catch(() => {
                  req.deny();
                });
              return;
            } catch (err) {
              const e = err as BusinessError;
              hilog.warn(DOMAIN, TAG, 'requestPermissionsFromUser failed: %{public}s', e?.message ?? String(err));
            }
          }
          req.grant(resources);
        })
        .onPageEnd(() => {
          this.pageLoaded = true;
          this.pushInsetsToWeb();
        })
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F6F7F9')
  }
}
