# TEST ONLY. Runtime/provider prerequisite for actual packaged UI creation.
ARG NATIVE_IMAGE
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS runtime
WORKDIR /opt/opencode-fixture
COPY tests/linux-native-opencode/tools/package*.json ./
RUN npm ci --no-audit --no-fund && test "$(node_modules/.bin/opencode --version)" = 'opencode v2.0.22'
FROM ${NATIVE_IMAGE}
USER root
ARG SOURCE_COMMIT
ARG DEB_SHA256
RUN test "${#SOURCE_COMMIT}" = 40 && test "${#DEB_SHA256}" = 64 && \
    test "$TEST_DEB_SOURCE_COMMIT" = "$SOURCE_COMMIT" && test "$TEST_DEB_SHA256" = "$DEB_SHA256"
RUN apt-get update && apt-get install -y --no-install-recommends tmux && rm -rf /var/lib/apt/lists/*
COPY --from=runtime /opt/opencode-fixture /opt/opencode-fixture
COPY tests/linux-native-opencode/stub-model.py /fixture/stub-model.py
COPY tests/linux-native-opencode/atomic.py /fixture/opencode-atomic.py
COPY tests/linux-native-opencode/prepare.py /fixture/opencode-prepare.py
RUN ln -s /opt/opencode-fixture/node_modules/.bin/opencode /usr/local/bin/opencode && \
    mkdir -p /run/user/10001 && chown 10001:10001 /run/user/10001 && chmod 700 /run/user/10001
USER smoke
CMD ["python3", "/fixture/opencode-atomic.py"]
