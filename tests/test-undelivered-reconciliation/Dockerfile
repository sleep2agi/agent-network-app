FROM oven/bun:1.3.14
WORKDIR /app
COPY package.json package-lock.json ./
RUN bun install --frozen-lockfile
COPY . .
CMD ["sh", "-c", "bun run scripts/run-tests.mjs && bunx tsc --noEmit -p tsconfig.build.json"]
