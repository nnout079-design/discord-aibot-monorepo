FROM node:20-slim

WORKDIR /app

# Native dependencies for @julusian/midi, serialport, and optional DMX/USB hardware
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    libasound2-dev \
    libudev-dev \
    libusb-1.0-0-dev \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --ignore-scripts --no-audit --fund=false

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

RUN groupadd -r companionuser && useradd -r -g companionuser -s /bin/false companionuser \
    && chown -R companionuser:companionuser /app
USER companionuser

CMD ["node", "dist/index.js"]
