FROM rust:1.85.1-slim-bookworm@sha256:9f841bbe9e7d8e37ceb96ed907265a3a0df7f44e3737d0b100e7907a679acb36 AS environment
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libdbus-1-dev dbus gnome-keyring libsecret-tools python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock ./
# Resolution only; this stage does not pretend to compile Tauri with a stub lib.
RUN mkdir src && touch src/lib.rs

FROM environment AS lock-update
RUN cargo update -p keyring --precise 3.6.3

FROM lock-update AS probe-lock
WORKDIR /probe
COPY tests/linux-credential-store/Cargo.toml ./
COPY tests/linux-credential-store/src ./src
RUN cp /app/Cargo.lock ./Cargo.lock && cargo update -p keyring --precise 3.6.3

FROM environment AS probe
WORKDIR /probe
COPY tests/linux-credential-store/Cargo.toml tests/linux-credential-store/Cargo.lock ./
COPY tests/linux-credential-store/src ./src
COPY tests/linux-credential-store/check-inputs.py ./
RUN python3 check-inputs.py && cargo build --locked --release
COPY tests/linux-credential-store/run.sh ./run.sh
COPY scripts/with-linux-test-keyring.sh ./with-linux-test-keyring.sh
RUN useradd --create-home --uid 10001 fixture
USER fixture
ENV HOME=/home/fixture
ENTRYPOINT ["sh", "/probe/run.sh"]
