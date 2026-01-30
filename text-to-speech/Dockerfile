# Build Stage
FROM rust:bookworm as builder
WORKDIR /app
COPY . .
RUN cargo build --release

# Runtime Stage
FROM python:3.11-slim-bookworm
WORKDIR /app

# Install system dependencies
# ffmpeg for audio conversion, espeak-ng for phonemization (common requirement for TTS)
RUN apt-get update && \
    apt-get install -y ffmpeg espeak-ng && \
    rm -rf /var/lib/apt/lists/*

# Install kokoro-tts
# Installing torch cpu version specifically often helps reduce size if GPU not needed/available
# But sticking to default pip install for simplicity unless size is critical
RUN pip install kokoro-tts soundfile

# Create output directory
RUN mkdir -p /tmp/tts-output

# Copy binary from builder
COPY --from=builder /app/target/release/text-to-speech /usr/local/bin/text-to-speech

EXPOSE 3000

CMD ["text-to-speech"]
