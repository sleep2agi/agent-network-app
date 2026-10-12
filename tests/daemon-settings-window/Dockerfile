# TEST-ONLY: scoped desktop window core. No host accounts or production state.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun
FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e AS test
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN bun src/api-network-scope.test.ts && bun src/drive-registry.test.ts && bun src/node-clone.test.ts && bun src/daemon-settings-window.test.ts && bun src/window-capabilities-contract.test.ts && bun src/window-chrome.test.ts && bun src/native-title-bar-theme.test.ts && npm run typecheck
ENV CI=1 EXPO_NO_TELEMETRY=1
RUN npx --no-install expo export -p web --output-dir /web

FROM mcr.microsoft.com/playwright:v1.58.2-noble@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d
WORKDIR /app
RUN npm install --no-audit --no-fund --ignore-scripts playwright@1.58.2
COPY --from=test /web/ /web/
COPY tests/test-layout-sweep/harness.mjs tests/test-layout-sweep/harness.mjs
COPY tests/daemon-settings-window/drive.mjs tests/daemon-settings-window/drive.mjs
ENV WEB_DIR=/web
CMD ["node", "tests/daemon-settings-window/drive.mjs"]
