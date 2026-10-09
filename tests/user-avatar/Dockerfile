FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun
FROM mcr.microsoft.com/playwright:v1.58.2-noble@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
RUN npm install --prefix /qa-tools --no-save --no-audit --no-fund esbuild@0.25.5 playwright@1.58.2
COPY . .
RUN bun src/radius-tokens.test.ts && bun src/human-avatar.test.ts && bun src/user-avatar-api.test.ts && bun src/auth-me-shared.test.ts && bun src/settings-model.test.ts && bun src/drive-registry.test.ts && npm run typecheck
RUN NODE_PATH=/qa-tools/node_modules node tests/user-avatar/build.cjs
ENV PLAYWRIGHT_MODULE=/qa-tools/node_modules/playwright/index.mjs
CMD ["node", "tests/user-avatar/drive.mjs"]
