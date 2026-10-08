FROM node:22-bookworm
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
RUN npm install --global bun@1.3.14
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
RUN npm install --prefix /qa-tools --no-save --no-audit --no-fund playwright@1.58.2
COPY . .
RUN npx expo export -p web --output-dir web-export --max-workers 2
ENV WEB_DIR=/app/web-export PLAYWRIGHT_MODULE=/qa-tools/node_modules/playwright/index.mjs OUT=/output CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
CMD ["sh", "-c", "bun src/chat-source-load.test.ts && bun src/conversation-store.test.ts && bun src/proactive-messages.test.ts && bun src/chat-history-pages.test.ts && bun src/user-messages-window.test.ts && node tests/test-chat-first-paint/mutation.mjs && npm run typecheck && node tests/test-chat-first-paint/drive.mjs"]
