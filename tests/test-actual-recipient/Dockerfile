FROM oven/bun:1.3.14
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN bun install --ignore-scripts
COPY . .
ARG SOURCE_COMMIT
ENV APP_ACTUAL_TO_SOURCE_COMMIT=$SOURCE_COMMIT
RUN chmod 0755 tests/test-actual-recipient/run.sh
ENTRYPOINT ["tests/test-actual-recipient/run.sh"]
