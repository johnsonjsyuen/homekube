# Build Stage for Rust backend
FROM rust:bookworm AS builder
WORKDIR /app

# Cache dependencies by building with dummy source first
COPY Cargo.toml Cargo.lock* rust-toolchain.toml ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -rf src

# Build real source (only this layer invalidates on code changes)
COPY src ./src
RUN touch src/main.rs && cargo build --release

# Runtime Stage
FROM debian:bookworm-slim
WORKDIR /app

# Install CA certificates for HTTPS requests
RUN apt-get update && \
    apt-get install -y ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy binary from builder
COPY --from=builder /app/target/release/speech-to-text /usr/local/bin/speech-to-text

EXPOSE 3000

CMD ["speech-to-text"]
