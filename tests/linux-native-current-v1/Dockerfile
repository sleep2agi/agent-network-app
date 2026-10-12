# Only the current public pair plus real native V1 creation. No candidate overlay.
ARG V1_MODEL_IMAGE
FROM ${V1_MODEL_IMAGE}
USER root
COPY tests/linux-native-current-v1/manifest.json /fixture/public-pair.json
COPY tests/linux-native-current-v1/prepare.py /fixture/current-pair-prepare.py
ENV TEST_DAEMON_PREFIX_PREPARE=/fixture/current-pair-prepare.py
USER smoke
