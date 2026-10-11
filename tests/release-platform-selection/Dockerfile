# TEST-ONLY: release platform selection and metadata; no publishing credentials.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun
FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY . .
CMD ["sh", "-c", "bun src/linux-desktop-release.test.ts && bun src/version-consistency.test.ts && bun src/changelog-bundled.test.ts && bun src/modelscope-mirror.test.ts"]
