# Build Stage
FROM ubuntu:24.04 AS builder

WORKDIR /app

# Install build dependencies and Rust (rarely changes)
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Cache dependencies by building with dummy source first
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -rf src

# Build real source (only this layer invalidates on code changes)
COPY src ./src
COPY migrations ./migrations
RUN touch src/main.rs && cargo build --release

# Model download stage (separate so code changes don't re-download)
FROM python:3.11-slim AS models

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /models
RUN wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx && \
    wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin

# Runtime Stage
FROM python:3.11-slim

WORKDIR /app

# Install only runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    espeak-ng \
    libportaudio2 \
    && rm -rf /var/lib/apt/lists/*

# Install kokoro-tts
RUN pip install --no-cache-dir kokoro-tts soundfile

# Copy models from download stage
COPY --from=models /models/kokoro-v1.0.onnx .
COPY --from=models /models/voices-v1.0.bin .

# Create output directory
RUN mkdir -p /tmp/tts-output

# Copy binary from builder
COPY --from=builder /app/target/release/text-to-speech /usr/local/bin/text-to-speech

EXPOSE 3000

CMD ["text-to-speech"]
