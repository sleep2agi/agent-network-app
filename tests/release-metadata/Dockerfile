# TEST ONLY: release metadata and bundled notes, no credentials or installation.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4
WORKDIR /app
COPY package.json package-lock.json app.json ./
COPY src ./src
COPY scripts/android-release-notes.mjs scripts/changelog-bundle.mjs ./scripts/
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json ./src-tauri/
COPY .github/workflows/release-desktop-auto-update.yml ./.github/workflows/
CMD ["sh", "-c", "bun src/version-consistency.test.ts && bun src/changelog-bundled.test.ts && bun src/release-notes-hygiene.test.ts"]
