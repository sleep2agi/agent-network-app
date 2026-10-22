# TEST-ONLY: no credentials, no package install, no production access.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4
WORKDIR /app
COPY src/ src/
COPY app.json package.json package-lock.json ./
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json src-tauri/
COPY scripts/ scripts/
COPY .github/workflows/release-desktop-auto-update.yml .github/workflows/release-desktop-auto-update.yml
COPY tests/daemon-provider-scope/run.sh tests/daemon-provider-scope/run.sh
CMD ["sh", "tests/daemon-provider-scope/run.sh"]
