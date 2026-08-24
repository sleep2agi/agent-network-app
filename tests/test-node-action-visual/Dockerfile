FROM node:22-bookworm

WORKDIR /work
COPY package.json package-lock.json ./
RUN npm ci && npm install --global bun@1.3.14
COPY . .

CMD ["sh", "-lc", "bun src/node-action-visual.test.ts && npm test && npm run typecheck"]
