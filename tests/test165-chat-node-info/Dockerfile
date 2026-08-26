FROM oven/bun:1.3.14-debian AS bun-runtime
FROM node:22-bookworm-slim
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json package-lock.json ./
RUN bun install --frozen-lockfile
COPY . .
ARG SOURCE_COMMIT
ENV SOURCE_COMMIT=$SOURCE_COMMIT
RUN chmod +x tests/test165-chat-node-info/run.sh
ENTRYPOINT ["bash", "tests/test165-chat-node-info/run.sh"]
