FROM node:22-slim

RUN npm install -g @anthropic-ai/claude-code

RUN useradd -m -s /bin/bash node || true
RUN mkdir -p /home/node/.claude && chown -R node:node /home/node

USER node
WORKDIR /home/node

CMD ["sleep", "infinity"]
