FROM rust:1.85.1-slim-bookworm@sha256:9f841bbe9e7d8e37ceb96ed907265a3a0df7f44e3737d0b100e7907a679acb36 AS policy
WORKDIR /suite
COPY src-tauri/src/local_daemon_packages.rs ./policy.rs
# Compile the actual dependency-free product policy, not a rewritten mock.
RUN rustc --edition 2021 --test policy.rs -o policy-test
USER 65534:65534
CMD ["/suite/policy-test", "--nocapture"]

FROM node:22-bookworm@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS private-prefix
WORKDIR /fixture
COPY src-tauri/src/local_daemon_packages.rs ./policy.rs
COPY tests/local-daemon-packages/probe.mjs ./probe.mjs
USER node
RUN mkdir -p /home/node/.anet/app/local-daemon/anet && \
    npm install -g --prefix /home/node/.anet/app/local-daemon/anet --no-audit --no-fund \
      @sleep2agi/agent-network@2.3.0-preview.162 @sleep2agi/agent-node@2.5.0-preview.128
ENV PATH=/home/node/.anet/app/local-daemon/anet/bin:$PATH
CMD ["node", "/fixture/probe.mjs"]
