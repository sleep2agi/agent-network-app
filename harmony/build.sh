#!/usr/bin/env bash
# 打鸿蒙包：导出 App 网页版 → 塞进外壳 → hvigor 出 .hap。
#
# 需要（都不用登录华为账号）：
#   OHOS_BASE_SDK_HOME  OpenHarmony 公开 SDK 根目录（其下 20/{ets,js,native,previewer,toolchains}），
#                       来源 https://repo.huaweicloud.com/openharmony/os/6.0-Release/ohos-sdk-windows_linux-public.tar.gz
#   HVIGOR_HOME         装了 @ohos/hvigor 与 @ohos/hvigor-ohos-plugin 的 node_modules 所在目录，
#                       npm i --registry https://repo.harmonyos.com/npm/ @ohos/hvigor @ohos/hvigor-ohos-plugin
# 产物：entry/build/default/outputs/default/entry-default-unsigned.hap（未签名）。
# 装到真机（HarmonyOS NEXT）需要华为开发者账号签发的证书，见 README.md。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/.." && pwd)"
: "${OHOS_BASE_SDK_HOME:?set OHOS_BASE_SDK_HOME to the OpenHarmony SDK root}"
: "${HVIGOR_HOME:?set HVIGOR_HOME to the folder holding node_modules/@ohos/hvigor}"
MODE="${1:-debug}"

WEB="$HERE/entry/src/main/resources/rawfile/web"
rm -rf "$WEB"
(cd "$APP" && npx expo export -p web --output-dir "$WEB")

ln -sfn "$HVIGOR_HOME/node_modules" "$HERE/node_modules"
export DEVECO_SDK_HOME="$OHOS_BASE_SDK_HOME"
cd "$HERE"
node node_modules/@ohos/hvigor/bin/hvigor.js --mode module -p product=default -p "buildMode=$MODE" assembleHap --no-daemon
ls -la entry/build/default/outputs/default/*.hap
