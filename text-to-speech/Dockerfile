# Build Stage
FROM ubuntu:24.04 AS builder

WORKDIR /app

# Install build dependencies including cmake for rdkafka
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    pkg-config \
    libssl-dev \
    cmake \
    libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Cache dependencies by building with dummy source first
COPY Cargo.toml Cargo.lock ./
RUN mkdir -p src/bin && \
    echo "fn main() {}" > src/bin/api.rs && \
    echo "fn main() {}" > src/bin/worker.rs && \
    echo "" > src/lib.rs
RUN cargo build --release
RUN rm -rf src

# Build real source (only this layer invalidates on code changes)
COPY src ./src
COPY migrations ./migrations
RUN touch src/lib.rs && cargo build --release

# Runtime Stage
FROM python:3.11-slim

WORKDIR /app

# Install only runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    espeak-ng \
    libportaudio2 \
    && rm -rf /var/lib/apt/lists/*

# Install kokoro-tts CLI (used by worker for file-based TTS)
RUN pip install --no-cache-dir kokoro-tts soundfile

# Create output directory
RUN mkdir -p /tmp/tts-output

# Copy both binaries from builder
COPY --from=builder /app/target/release/tts-api /usr/local/bin/tts-api
COPY --from=builder /app/target/release/tts-worker /usr/local/bin/tts-worker

EXPOSE 3000 3001

# Default to API; worker deployment overrides via k8s command
CMD ["tts-api"]
