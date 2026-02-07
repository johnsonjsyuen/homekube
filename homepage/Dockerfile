FROM node:20-slim AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build
RUN yarn install --production --ignore-scripts --prefer-offline

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/build build/
COPY --from=builder /app/node_modules node_modules/
COPY package.json .
COPY server.js .
EXPOSE 3000
ENV NODE_ENV=production
CMD [ "node", "server.js" ]
