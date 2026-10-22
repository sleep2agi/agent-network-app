FROM node:22.23.0-bookworm@sha256:e0d149b4727ac0c20d9774e801e423d7a946a0bffced886f42cfe9cd3c67820a AS core
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY assets/icon.png ./assets/icon.png
COPY scripts/generate-windows-installer-brand.mjs ./scripts/
COPY src/windows-installer-brand.test.ts src/nsis-template-baseline.test.ts src/nsis-install-identity.test.ts ./src/
COPY bun.lock ./
COPY src-tauri/tauri.conf.json ./src-tauri/
COPY src-tauri/windows ./src-tauri/windows
CMD ["sh", "-c", "node --experimental-strip-types src/windows-installer-brand.test.ts && node --experimental-strip-types src/nsis-template-baseline.test.ts && node --experimental-strip-types src/nsis-install-identity.test.ts"]

FROM core AS compile
RUN apt-get update && apt-get install -y --no-install-recommends nsis node-handlebars curl ca-certificates && rm -rf /var/lib/apt/lists/*
ARG TAURI_COMMIT=499df79be65ef8c0670abc0207cd9e37b55d8491
RUN mkdir -p /fixture/plugins && cd /fixture && for name in utils.nsh FileAssociation.nsh languages/English.nsh; do curl --retry 2 -fsSL "https://raw.githubusercontent.com/tauri-apps/tauri/${TAURI_COMMIT}/crates/tauri-bundler/src/bundle/windows/nsis/${name}" -o "$(basename "$name")"; done && curl --retry 2 -fsSL https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll -o plugins/nsis_tauri_utils.dll && echo '75197fee3c6a814fe035788d1c34ead39349b860  plugins/nsis_tauri_utils.dll' | sha1sum -c -
COPY tests/windows-installer-brand/compile.cjs ./tests/windows-installer-brand/
CMD ["node", "tests/windows-installer-brand/compile.cjs"]
