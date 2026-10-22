FROM rust:1.90-bookworm@sha256:3914072ca0c3b8aad871db9169a651ccfce30cf58303e5d6f2db16d1d8a7e58f
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY tests/local-daemon-init/Cargo.toml tests/local-daemon-init/Cargo.lock tests/local-daemon-init/
COPY tests/local-daemon-init/src tests/local-daemon-init/src
COPY src-tauri/src/local_daemon.rs src-tauri/src/local_daemon.rs
RUN cargo test --locked --manifest-path tests/local-daemon-init/Cargo.toml --no-run
CMD ["cargo", "test", "--locked", "--manifest-path", "tests/local-daemon-init/Cargo.toml", "--", "--test-threads=1", "--nocapture"]
