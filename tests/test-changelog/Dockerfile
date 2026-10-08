FROM mcr.microsoft.com/playwright:v1.58.2-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
RUN npm install --prefix /qa-tools --no-save --no-audit --no-fund playwright@1.58.2
COPY . .
RUN npx expo export -p web --output-dir web-export --max-workers 2
ENV WEB_DIR=/app/web-export PLAYWRIGHT_MODULE=/qa-tools/node_modules/playwright/index.mjs OUT=/output
CMD ["node", "tests/test-changelog/drive.mjs"]
