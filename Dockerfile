FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node src ./src

RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3101 3102 3103 3104
CMD ["node", "src/server.js"]
