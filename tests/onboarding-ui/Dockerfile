FROM oven/bun:1.3.14
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN bun install --ignore-scripts
COPY . .
ARG SOURCE_COMMIT
ENV ONBOARDING_UI_SOURCE_COMMIT=$SOURCE_COMMIT
RUN chmod 0755 tests/onboarding-ui/run.sh
ENTRYPOINT ["tests/onboarding-ui/run.sh"]
