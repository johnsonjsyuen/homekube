FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json yarn.lock ./
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" && \
    yarn install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ ./src/

RUN yarn build

FROM node:22-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json yarn.lock ./
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" && \
    yarn install --frozen-lockfile --production

COPY --from=builder /app/dist/ ./dist/
COPY src/migrations/ ./dist/migrations/

EXPOSE 3000

CMD ["node", "dist/index.js"]
