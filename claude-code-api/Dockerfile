# Stage 1: Build Rust binary
FROM rust:1.85-slim AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release && rm -rf src
COPY src/ src/
RUN touch src/main.rs && cargo build --release

# Stage 2: Runtime with Node.js + Claude Code
FROM node:22-slim
RUN npm install -g @anthropic-ai/claude-code
COPY --from=builder /app/target/release/claude-code-api /usr/local/bin/
EXPOSE 3000
ENV RUST_LOG=info
CMD ["claude-code-api"]
