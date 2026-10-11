# TEST-ONLY. Locked dependencies; no host state or credentials mounted.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun
FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e AS test
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
CMD ["sh", "-c", "bun --no-install src/daemon-provider-management.test.ts && npm run typecheck"]

FROM test AS web
ENV CI=1 EXPO_NO_TELEMETRY=1
RUN npx --no-install expo export -p web --output-dir /web

FROM scratch AS web-export
COPY --from=web /web/ /
