FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4
# TEST ONLY: compare shipped bytes with an exact GitHub main ancestor.
ADD https://registry.npmjs.org/@sleep2agi/commhub-server/-/commhub-server-0.9.0-preview.120.tgz /tmp/hub.tgz
ADD https://github.com/sleep2agi/agent-network/archive/edc68a4ca87bbb7ca4944093e8ff113a17078624.tar.gz /tmp/source.tgz
RUN bun -e 'import {createHash} from "node:crypto"; import {readFileSync} from "node:fs"; if(createHash("sha512").update(readFileSync("/tmp/hub.tgz")).digest("base64")!=="lluvIp478F3UiFXC8v4Dy8x1uvb/UhgXPWvRi5R2ii3lB4nYEqFn4KUZBO6mH7WRoEQBaGnqKhNFWLekTxpsOw==")throw Error("candidate integrity mismatch")'
RUN mkdir /candidate /source && tar -xzf /tmp/hub.tgz -C /candidate --strip-components=1 && tar -xzf /tmp/source.tgz -C /source --strip-components=1
COPY tests/bundled-hub-provenance/probe.mjs /probe.mjs
USER bun
CMD ["bun", "/probe.mjs"]
