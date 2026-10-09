FROM oven/bun:1.3.14
WORKDIR /workspace
COPY src ./src
ARG SOURCE_COMMIT
ENV SOURCE_COMMIT=$SOURCE_COMMIT
COPY tests/create-completion/run.sh /run-tests.sh
ENTRYPOINT ["sh", "/run-tests.sh"]
