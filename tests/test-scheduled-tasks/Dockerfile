FROM oven/bun:1.3.14
WORKDIR /workspace
COPY package.json bun.lock package-lock.json* ./
RUN bun install --ignore-scripts
COPY . .
ARG SOURCE_COMMIT
ENV APP_SCHEDULER_SOURCE_COMMIT=$SOURCE_COMMIT
RUN chmod 0755 tests/test-scheduled-tasks/run.sh
ENTRYPOINT ["tests/test-scheduled-tasks/run.sh"]
