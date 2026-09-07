FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm install --ignore-scripts --no-audit --fund=false

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

RUN addgroup -g 1001 sounduser && \
    adduser -u 1001 -G sounduser -s /bin/sh -D sounduser && \
    chown -R sounduser:sounduser /app

USER sounduser

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD node -e "process.exit(0)" || exit 1

CMD ["node", "dist/index.js"]
