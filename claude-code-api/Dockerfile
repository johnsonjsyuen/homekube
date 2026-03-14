# Stage 1: Build Rust binary
FROM rust:1.88-slim AS builder
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release && rm -rf src
COPY src/ src/
COPY migrations/ migrations/
RUN touch src/main.rs && cargo build --release

# Stage 2: Runtime with Node.js + Claude Code
FROM node:22-slim
RUN apt-get update && apt-get install -y git curl && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && apt-get install -y gh && \
    rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code
COPY --from=builder /app/target/release/claude-code-api /usr/local/bin/
COPY migrations/ /app/migrations/
RUN chown -R node:node /app
EXPOSE 3000
ENV RUST_LOG=info
USER node
RUN git config --global credential.https://github.com.helper '!gh auth git-credential' && \
    git config --global credential.https://gist.github.com.helper '!gh auth git-credential'
CMD ["claude-code-api"]
