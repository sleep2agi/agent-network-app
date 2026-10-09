FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4
# Candidate only; does not modify the production sidecar pin or release channels.
ADD https://registry.npmjs.org/@sleep2agi/commhub-server/-/commhub-server-0.9.0-preview.120.tgz /tmp/hub.tgz
RUN bun -e 'import {createHash} from "node:crypto"; import {readFileSync} from "node:fs"; if(createHash("sha512").update(readFileSync("/tmp/hub.tgz")).digest("base64")!=="lluvIp478F3UiFXC8v4Dy8x1uvb/UhgXPWvRi5R2ii3lB4nYEqFn4KUZBO6mH7WRoEQBaGnqKhNFWLekTxpsOw==")throw Error("candidate integrity mismatch")'
RUN mkdir /candidate && tar -xzf /tmp/hub.tgz -C /candidate --strip-components=1
COPY tests/bundled-hub-v2-contract/probe.ts /fixture/probe.ts
COPY local-hub-sidecar/package.json local-hub-sidecar/package-lock.json /fixture/
COPY src-tauri/src/local_hub.rs /fixture/local_hub.rs
USER bun
CMD ["bun", "/fixture/probe.ts"]
