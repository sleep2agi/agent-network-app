# TEST ONLY: upstream must pass linux-deb-package and linux-deb-install gates.
ARG INSTALL_IMAGE
FROM ${INSTALL_IMAGE}
USER root
ARG SOURCE_COMMIT
ARG DEB_SHA256
RUN test "$TEST_DEB_SOURCE_COMMIT" = "$SOURCE_COMMIT" && \
    test "$TEST_DEB_SHA256" = "$DEB_SHA256"
RUN apt-get update && apt-get install -y --no-install-recommends \
    gnome-keyring libsecret-tools xdotool python3 && \
    rm -rf /var/lib/apt/lists/*
COPY scripts/with-linux-test-keyring.sh /fixture/keyring.sh
COPY tests/linux-native-workspace/atomic.sh /fixture/atomic.sh
COPY tests/linux-native-workspace/ui.sh /fixture/ui.sh
COPY tests/linux-native-workspace/verify-session.py /fixture/verify-session.py
USER smoke
ENV ANET_ISOLATED_KEYRING_TEST=1 ANET_PACKAGED_SMOKE=1
ENV ANET_PACKAGED_SMOKE_ROOT=/home/smoke/native-workspace-test
CMD ["sh", "/fixture/keyring.sh", "bash", "/fixture/atomic.sh"]
