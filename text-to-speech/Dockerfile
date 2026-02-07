# Build Stage
FROM ubuntu:24.04 as builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

COPY . .

RUN cargo build --release

# Runtime Stage
FROM ubuntu:24.04

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    espeak-ng \
    libportaudio2 \
    wget \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create a virtual environment for Python dependencies
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Download Kokoro models
RUN wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx && \
    wget -q https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin

# Install kokoro-tts
RUN pip install kokoro-tts soundfile

# Create output directory
RUN mkdir -p /tmp/tts-output

# Copy binary from builder
COPY --from=builder /app/target/release/text-to-speech /usr/local/bin/text-to-speech

EXPOSE 3000

CMD ["text-to-speech"]
