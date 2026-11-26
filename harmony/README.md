# ANet 鸿蒙版（HarmonyOS NEXT / 5 / 6）

新鸿蒙（HarmonyOS 5 / 6 / NEXT）不支持直接安装安卓 APK，App 使用的 Expo / React Native 0.85 也没有官方鸿蒙目标。
`harmony/` 是原生 ArkTS / Stage Model（API 12+）ArkWeb 外壳工程，内嵌导出的 ANet Expo Web 移动端界面，并通过原生 JSBridge（`window.__ANET_HARMONY__`）接入系统网络、持久化存储、动态安全区、麦克风授权与侧滑返回。

老鸿蒙（HarmonyOS 4 及以前）可直接安装安卓 APK，不需要使用本外壳。

---

## 怎么工作

- **离线界面资源**：根目录 `npm run build:harmony-web` 会把 Expo Web 产物导出到 `harmony/entry/src/main/resources/rawfile/web/` 并同步 `package.json` 版本号到 `harmony/AppScope/app.json5`。ArkWeb 从虚拟站点 `https://anet.local/` 加载，`onInterceptRequest` 直接从 `rawfile/web/` 读包内静态资源（离线可打开，支持 `/_expo/...` 绝对路径与 SPA 路由回退）。
- **原生网络层（无 CORS）**：通过 `@kit.RemoteCommunicationKit`（`rcp`）代发 `GET/POST/PUT/PATCH/DELETE` 请求（支持局域网 HTTP 与公网 HTTPS/2 Hub，二进制/UTF-8 均走 Base64）。因为 ArkWeb `javaScriptProxy` 的 `asyncMethodList` 不会把返回值直接传回 JS，桥采用 **`httpFetchAsync(reqId, reqJson)` + `controller.runJavaScript("window.__ANET_HARMONY_HTTP_RESOLVE__(...)")`** 异步回调，并过滤 HTTP/2 `:` 伪响应头。App 侧 `src/app-fetch.ts` 检测到 `window.__ANET_HARMONY__` 即自动走 `src/harmony-bridge.ts`。
- **原生 KV 持久化**：登录凭据与多账号配置写入 `@kit.ArkData` `preferences`（`anet_kv`），清理 WebView 缓存不掉登录。
- **动态安全区 & 键盘避让**：`EntryAbility` 监听 `window.on('avoidAreaChange')` 实时同步状态栏/挖孔/底部导航条到 Web，配合 `WebKeyboardAvoidMode.RESIZE_CONTENT` 避让软键盘。
- **阔直板与平板自适应**：`src/wide-layout.ts` 识别 `OpenHarmony / HarmonyOS / ANetHarmony` UA，16:9.5 阔直板竖屏（~440vp）保持手机单栏，横屏（≥ 700vp）与平板自动切换双栏。
- **侧滑返回与麦克风授权**：`onBackPress` 优先交由 `window.__ANET_HARMONY_BACK__` 返回应用内上一页，根页平滑退后台；`module.json5` 声明 `ohos.permission.MICROPHONE`，`onPermissionRequest` 触发系统权限弹窗后放行网页侧录音。

---

## 构建（使用 DevEco Studio 或华为 Command Line Tools）

> 本外壳使用了 HarmonyOS 专有能力 `@kit.RemoteCommunicationKit`（`rcp`），需要 **DevEco Studio** 或 **Command Line Tools for HarmonyOS**（包含 `sdk/default/hms`），仅靠公开 OpenHarmony SDK 无法编过，因此不保留基于公开 SDK 的 `build.sh`。

### 1. 导出前端包（改 App 代码后先执行）

```bash
npm run build:harmony-web
```

### 2. 方式 A：DevEco Studio 一键编译、自动签名并装机（推荐）

1. 用 **DevEco Studio 5.0+ / 26.x** 打开仓库下的 `harmony/` 目录；
2. USB 连接鸿蒙真机（打开 **开发者选项 → USB 调试**）；
3. 菜单 **File → Project Structure → Signing Configs**，勾选 **Automatically generate signature** 登录华为开发者账号自动绑定真机调试签名；
4. 点击 **▶ Run** 编译签名并安装到真机。

### 3. 方式 B：DevEco / Command Line Tools 无头命令行构建

配置华为 Command Line Tools 环境变量后：

```bash
export TOOL_HOME="/opt/command-line-tools"
export DEVECO_SDK_HOME="$TOOL_HOME/sdk"
export PATH="$TOOL_HOME/bin:$TOOL_HOME/tool/node/bin:$PATH"

npm run build:harmony-web
cd harmony
ohpm install
hvigorw assembleHap --no-daemon -p buildMode=release
```

未签名产物：`harmony/entry/build/default/outputs/default/entry-default-unsigned.hap`。

---

## 签名与装机（需要华为开发者账号）

HarmonyOS NEXT 真机只允许安装经华为证书签名的 `.hap`：

1. 在 AppGallery Connect（AGC）创建应用（或使用 DevEco Studio 自动调试签名），用 `hdc shell bm get --udid` 获取设备 UDID 并登记到调试 Profile；
2. 本地签名配置不要提交进仓库；使用命令行签名可执行：

```bash
java -jar "$TOOL_HOME/sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar" sign-app \
  -keyAlias "$HARMONY_KEY_ALIAS" \
  -signAlg "SHA256withECDSA" \
  -mode "localSign" \
  -appCertFile "$HARMONY_CERT_CER" \
  -profileFile "$HARMONY_PROFILE_P7B" \
  -inFile "harmony/entry/build/default/outputs/default/entry-default-unsigned.hap" \
  -keystoreFile "$HARMONY_KEYSTORE_P12" \
  -outFile "harmony/entry/build/default/outputs/default/ANet-harmony-signed.hap" \
  -keyPwd "$HARMONY_KEY_PASS" \
  -keystorePwd "$HARMONY_STORE_PASS"
```

3. USB 安装到真机：

```bash
hdc install -r harmony/entry/build/default/outputs/default/ANet-harmony-signed.hap
```

---

## 发布到 GitHub Release 与官网自动亮灯（`www.anet.sh`）

官网下载页（`sleep2agi/agent-network#3904`）与国内镜像脚本（`scripts/modelscope-mirror.mjs`）已自动识别标准命名 **`Agent.Network_<版本>_harmony.hap`**（并在镜像 `desktop/latest/` 下同步生成 `Agent.Network_harmony.hap` 与 `SHA256SUMS`）：

> 注意：DevEco Studio 自动调试签名（Debug Profile）绑定测试机 UDID，仅限登记设备安装；面向官网公开下载需使用华为 AppGallery Connect 签发的 **发布/企业签名证书**（`.p12` + `.cer` + `.p7b`）。

签名完成后执行：

```bash
# 生成 harmony/dist/Agent.Network_<版本>_harmony.hap 及 .sha256
npm run package:harmony-hap -- --input harmony/entry/build/default/outputs/default/ANet-harmony-signed.hap

# 上传到对应 desktop-v<版本> Release（官网检测有 .hap 后自动点亮鸿蒙下载按钮）
npm run package:harmony-hap -- --input harmony/entry/build/default/outputs/default/ANet-harmony-signed.hap --upload
```

上传后触发一次 `modelscope-mirror.yml` 即可同步国内镜像和 `SHA256SUMS`。

---

## 现状

- [x] **真机端到端验收已通过**（设备：**HUAWEI MatePad Mini / MLR-AL10**，系统：**HarmonyOS 6.1 / API 24**，DevEco Studio 26.0.1.290 自动签名安装）：
  - 冷启动无白屏，Logo / 图标字体 / 中文排版完整，实测 `e2e = 845ms`、`FCP = 1124ms`、`FMP = 1334ms`；
  - 原生 `rcp` 网络通道经 `httpFetchAsync → HTTPS/2 → __ANET_HARMONY_HTTP_RESOLVE__` 跑通登录请求（`POST https://y.vansin.top`，无 CORS 报错，HTTP/2 `:status` 伪头正常过滤）；
  - 状态栏 `104px` + 底部导航条 `66px` 动态安全区、键盘弹出缩放避让、页面切换与根页侧滑退后台均通过。
- [x] App 侧单测覆盖完整（`src/harmony-bridge.test.ts`、`src/wide-layout.test.ts`）。
- [ ] 真机按住说话语音输入（已接入 `ohos.permission.MICROPHONE` + `onPermissionRequest`，待真机复验）。
- [ ] 正式发布证书签名上架华为应用市场 / 官网 `.hap` 直链分发。
