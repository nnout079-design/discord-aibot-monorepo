FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm install --ignore-scripts --no-audit --fund=false

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

RUN addgroup -g 1001 airhornuser && \
    adduser -u 1001 -G airhornuser -s /bin/sh -D airhornuser && \
    chown -R airhornuser:airhornuser /app

USER airhornuser

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD node -e "process.exit(0)" || exit 1

CMD ["node", "dist/index.js"]