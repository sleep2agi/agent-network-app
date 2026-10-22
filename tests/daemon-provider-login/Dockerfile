# TEST-ONLY client command layer; no real login, token or model request.
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4
WORKDIR /check
COPY src/daemon-provider-login.ts src/daemon-provider-login-contract.ts src/daemon-provider-login.test.ts ./
CMD ["bun", "daemon-provider-login.test.ts"]
