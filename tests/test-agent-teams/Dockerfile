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
CMD ["sh", "-c", "bun src/settings-model.test.ts && bun src/settings-phone-list.test.ts && bun src/settings-subpages.test.ts && bun src/settings-redesign.test.ts && bun src/agent-teams.test.ts && bun src/agent-teams-load.test.ts && bun src/i18n-copy-guard.test.ts && npm run typecheck && node tests/test-agent-teams/drive.mjs"]
