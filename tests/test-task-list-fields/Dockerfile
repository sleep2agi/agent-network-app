FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293
WORKDIR /app
RUN apk add --no-cache openssl
RUN npm install --global bun@1.3.1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN bun src/task-list-fields.test.ts && bun src/task-time.test.ts && bun src/i18n-copy-guard.test.ts && npm run typecheck
RUN npm install --prefix /qa-tools --no-save --no-audit --no-fund esbuild@0.25.5
RUN NODE_PATH=/qa-tools/node_modules node tests/test-task-language/build.cjs
CMD ["sh", "-c", "cp /task-language.js /output/task-language.js"]
