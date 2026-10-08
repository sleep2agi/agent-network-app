FROM node:22.23.0-bookworm@sha256:e0d149b4727ac0c20d9774e801e423d7a946a0bffced886f42cfe9cd3c67820a
WORKDIR /app
COPY bun.lock ./
COPY src-tauri/tauri.conf.json ./src-tauri/
COPY src-tauri/windows/vendor ./src-tauri/windows/vendor
COPY src/nsis-template-baseline.test.ts src/nsis-install-identity.test.ts ./src/
COPY tests/nsis-install-identity/mutation.mjs ./tests/nsis-install-identity/
CMD ["sh", "-c", "node --experimental-strip-types src/nsis-template-baseline.test.ts && node --experimental-strip-types src/nsis-install-identity.test.ts"]
