FROM node:22-bookworm@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS node
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun
FROM rust:1.90.0-slim-bookworm@sha256:64232e656c058f4468e8d024e990acff04f0fd5a5c0a88a574dc37773d7325c9 AS rust
FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55 AS build
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config patchelf libssl-dev libdbus-1-dev \
    libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
    librsvg2-dev libxdo-dev ca-certificates curl git file python3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/ /usr/local/
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=rust /usr/local/cargo/ /usr/local/cargo/
COPY --from=rust /usr/local/rustup/ /usr/local/rustup/
ENV PATH=/usr/local/cargo/bin:$PATH RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo
ENV CI=1 EXPO_NO_TELEMETRY=1 CARGO_BUILD_JOBS=2
WORKDIR /app
RUN test "$(dpkg --print-architecture)" = amd64 && rustc --version && node --version && bun --version
COPY package.json package-lock.json ./
RUN npm ci
COPY local-hub-sidecar/package.json local-hub-sidecar/package-lock.json ./local-hub-sidecar/
RUN npm ci --prefix local-hub-sidecar --ignore-scripts
COPY . .
ARG SOURCE_COMMIT
ENV TEST_DEB_SOURCE_COMMIT=$SOURCE_COMMIT
RUN node -e 'if (!/^[a-f0-9]{40}$/.test(process.env.TEST_DEB_SOURCE_COMMIT || "")) throw new Error("exact source SHA required")'
RUN npm run typecheck && npx --no-install expo export -p web && test -s dist/index.html
RUN npx --no-install tauri icon assets/icon.png && npm run build:local-hub-sidecar
RUN npx --no-install tauri build --ci --no-sign --bundles deb --config tests/linux-deb-package/tauri.test.conf.json -- --locked
RUN node tests/linux-deb-package/verify.mjs
CMD ["node", "tests/linux-deb-package/verify.mjs"]
