# Build Stage for Rust backend
FROM rust:bookworm as builder
WORKDIR /app

# Copy source files (excluding model files which are large)
COPY Cargo.toml Cargo.lock* rust-toolchain.toml ./
COPY src ./src

RUN cargo build --release

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
