# Builds the Linux CLI archive on the Ubuntu that release CI used, whose
# libatomic and dpkg metadata scripts/build-cli-archive.ts bundles.
FROM ubuntu:24.04

ARG NODE_VERSION
ARG VITE_PLUS_VERSION

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl git jq libatomic1 libsecret-1-dev patchelf pkg-config python3 xz-utils \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
  | tar -xJ -C /usr/local --strip-components=1 \
  && npm install -g "vite-plus@${VITE_PLUS_VERSION}"

ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
  && chmod -R a+rwX /usr/local/rustup /usr/local/cargo
