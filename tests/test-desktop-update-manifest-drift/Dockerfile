FROM node:22-bookworm

WORKDIR /work
COPY package.json package-lock.json ./
RUN npm ci && npm install --global bun@1.3.14
COPY . .

CMD ["sh", "-lc", "bun src/desktop-update-manifest-drift.test.ts && npm test && npm run typecheck && node scripts/verify-desktop-update-manifest.mjs"]
