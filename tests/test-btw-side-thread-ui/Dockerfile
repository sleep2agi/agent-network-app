FROM oven/bun:1.3.14

WORKDIR /app
COPY package.json package-lock.json ./
RUN bun install --frozen-lockfile
COPY . .
ARG SOURCE_COMMIT=unrecorded
ENV BTW_UI_SOURCE_COMMIT=$SOURCE_COMMIT
RUN chmod 0755 tests/test-btw-side-thread-ui/run.sh
ENTRYPOINT ["tests/test-btw-side-thread-ui/run.sh"]
