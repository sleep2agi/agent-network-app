FROM node:22.23.0-bookworm@sha256:e0d149b4727ac0c20d9774e801e423d7a946a0bffced886f42cfe9cd3c67820a
WORKDIR /app
COPY . .
CMD ["sh", "-ec", "node src/wix-install-identity.test.ts && node src/wix-template-baseline.test.ts && node src/app-display-name.test.ts && node tests/wix-install-identity/mutation.mjs"]
