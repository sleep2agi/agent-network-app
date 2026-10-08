FROM node:22.23.0-bookworm@sha256:e0d149b4727ac0c20d9774e801e423d7a946a0bffced886f42cfe9cd3c67820a
WORKDIR /test
COPY .github/workflows/desktop-tauri.yml .github/workflows/release-macos.yml .github/workflows/
COPY src/macos-bundle-path.test.ts src/macos-bundle-path.test.ts
USER node
CMD ["node", "src/macos-bundle-path.test.ts"]
