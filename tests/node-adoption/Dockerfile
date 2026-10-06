FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293
WORKDIR /app
RUN apk add --no-cache openssl && npm install --global bun@1.3.1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN bun src/node-adoption.test.ts && bun src/node-lifecycle-api.test.ts && bun src/node-danger-actions.test.ts && bun src/drive-registry.test.ts && bun src/i18n-copy-guard.test.ts && npm run typecheck
RUN apk add --no-cache chromium font-noto-cjk && npm install --prefix /qa-tools --no-save --no-audit --no-fund esbuild@0.25.5 playwright@1.56.1
RUN NODE_PATH=/qa-tools/node_modules node tests/node-adoption/build.cjs
CMD ["node", "tests/node-adoption/drive.mjs"]
