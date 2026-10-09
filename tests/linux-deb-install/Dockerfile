ARG DEB_IMAGE
FROM ${DEB_IMAGE} AS package
ARG SOURCE_COMMIT
RUN test "$TEST_DEB_SOURCE_COMMIT" = "$SOURCE_COMMIT" || \
    { echo 'FAIL: package image source SHA does not match requested source' >&2; exit 1; }
FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
ENV DEBIAN_FRONTEND=noninteractive
COPY --from=package /app/src-tauri/target/release/bundle/deb/*.deb /tmp/anet.deb
ARG DEB_SHA256
ARG SOURCE_COMMIT
RUN test "${#SOURCE_COMMIT}" = 40 && test "${#DEB_SHA256}" = 64 && \
    printf '%s  /tmp/anet.deb\n' "$DEB_SHA256" | sha256sum -c - && \
    apt-get update && apt-get install -y --no-install-recommends /tmp/anet.deb && \
    test "$(dpkg-query -W -f='${Status}' a-net)" = 'install ok installed' && \
    ldd /usr/bin/agent-network-desktop > /tmp/anet-linkage.txt && \
    ! grep -F 'not found' /tmp/anet-linkage.txt
# Install fixture tools ONLY after package dependency validation above.
RUN apt-get install -y --no-install-recommends xvfb xauth dbus-x11 x11-utils imagemagick fonts-noto-cjk procps && \
    useradd --create-home --uid 10001 smoke && mkdir /evidence && chown smoke:smoke /evidence && \
    rm -rf /var/lib/apt/lists/*
ENV TEST_DEB_SOURCE_COMMIT=$SOURCE_COMMIT TEST_DEB_SHA256=$DEB_SHA256
COPY tests/linux-deb-install/run.sh /fixture/run.sh
USER smoke
WORKDIR /home/smoke
CMD ["dbus-run-session", "--", "xvfb-run", "-a", "-s", "-screen 0 1280x900x24 -nolisten tcp", "bash", "/fixture/run.sh"]
