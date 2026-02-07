FROM rust:1.92-slim-bookworm AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cache dependencies by building with dummy source first
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -rf src

# Build real source (only this layer invalidates on code changes)
COPY src ./src
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim

# Install dependencies and speedtest-cli
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg1 \
    apt-transport-https \
    dirmngr \
    && rm -rf /var/lib/apt/lists/*

# Install official Ookla speedtest-cli
RUN curl -s https://packagecloud.io/install/repositories/ookla/speedtest-cli/script.deb.sh | bash \
    && apt-get install -y speedtest \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/speedtest /app/speedtest

# Runtime env vars
ENV RUST_LOG=info

CMD ["./speedtest"]
