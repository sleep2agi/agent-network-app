# ANet 鸿蒙版（HarmonyOS NEXT 外壳）

新鸿蒙（HarmonyOS 5 / NEXT）不能装安卓包，App 用的 Expo / React Native 0.85 也没有官方鸿蒙版。
这里是一个**原生鸿蒙外壳**：用系统 ArkWeb 打开随包附带的 App 网页版，界面和功能与网页版 / 手机版一致。

老鸿蒙（HarmonyOS 4 及以前）能装安卓包，直接用安卓版，不需要这个包。

## 怎么工作

- **界面**：`build.sh` 先 `expo export -p web`，把 App 网页版塞进 `entry/src/main/resources/rawfile/web`。
  外壳用虚拟站点 `https://app.anet.local/` 加载，在 `onInterceptRequest` 里直接从包里读文件，所以：
  - 不联网也能打开界面；
  - `/_expo/...` 这样的绝对路径能找到；
  - 单页路由（没有扩展名的路径）一律返回 `index.html`。
- **联网**：网页里直接 `fetch` Hub，会被浏览器的跨域规则挡住（Hub 只放行 `COMMHUB_CORS_ORIGINS` 里的来源）。
  外壳注册了 `anetHarmony.fetch(json) => Promise<json>`，由系统网络库（`@kit.NetworkKit`）代发请求。
  App 的 `src/app-fetch.ts` 检测到它，就走这条路（和桌面版走 Tauri 原生 HTTP 是同一个思路）。
  请求体、响应体都用 base64 往返，图片和附件也能原样传。
- **麦克风**：`module.json5` 声明了 `ohos.permission.MICROPHONE`。网页侧的录音请求在 `onPermissionRequest` 里放行，系统会先弹自己的授权框。

## 构建（不需要华为账号）

```bash
# 1. OpenHarmony 公开 SDK（API 20），只解 Linux 部分
mkdir -p ~/ohos && cd ~/ohos
curl -s https://repo.huaweicloud.com/openharmony/os/6.0-Release/ohos-sdk-windows_linux-public.tar.gz \
  | tar -xz --wildcards '*linux*'
mkdir -p sdk/20 && for z in linux/*.zip; do unzip -q -o "$z" -d sdk/20/; done

# 2. hvigor（华为公开 npm 源）
mkdir -p ~/ohos/tools && cd ~/ohos/tools && echo '{"private":true}' > package.json
npm i --registry https://repo.harmonyos.com/npm/ @ohos/hvigor @ohos/hvigor-ohos-plugin

# 3. 需要 Java 17（打包与签名工具是 jar）
sudo apt-get install -y openjdk-17-jre-headless

# 4. 打包
cd <App 仓库>/harmony
OHOS_BASE_SDK_HOME=~/ohos/sdk HVIGOR_HOME=~/ohos/tools ./build.sh          # debug
OHOS_BASE_SDK_HOME=~/ohos/sdk HVIGOR_HOME=~/ohos/tools ./build.sh release
```

产物：`entry/build/default/outputs/default/entry-default-unsigned.hap`（未签名，约 13 MB）。

## 签名与装机（需要华为开发者账号）

HarmonyOS NEXT 真机只装华为证书签过名的包，这一步绕不开：

1. 用华为开发者账号（个人实名即可）登录 AppGallery Connect，新建应用，包名填 `sh.anet.app`。
2. 生成调试证书和 Profile。调试 Profile 要登记手机的 UDID，用 `hdc shell bm get --udid` 查。
3. 把 `.p12`、`.cer`、`.p7b` 填进 `build-profile.json5` 的 `signingConfigs`。只在本机填，**不要提交**。
4. 手机打开开发者模式，用 USB 连上，执行 `hdc install entry/build/default/outputs/default/entry-default-signed.hap`。

上架华为应用市场，用的是发布证书和发布 Profile，流程同上。

## 现状

- [x] 外壳工程用 OpenHarmony SDK 6.0（API 20）+ hvigor 6.26 编译通过，出了未签名的 hap。
- [x] App 侧的原生请求桥有单测（`src/app-fetch-harmony.test.ts`）。
- [ ] 真机或模拟器上跑过 —— 要等华为开发者账号签名后才能做。鸿蒙模拟器只在 DevEco Studio 里有，也要登录。
