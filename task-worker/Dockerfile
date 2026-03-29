FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/

FROM oven/bun:1
WORKDIR /app
COPY --from=builder /app ./
CMD ["bun", "run", "src/worker.ts"]
