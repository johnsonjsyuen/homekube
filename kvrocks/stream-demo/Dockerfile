FROM rust:1.85-bookworm AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim

RUN useradd --create-home --uid 10001 app
COPY --from=builder /app/target/release/kvrocks-stream-demo /usr/local/bin/kvrocks-stream-demo
USER app

ENTRYPOINT ["/usr/local/bin/kvrocks-stream-demo"]
