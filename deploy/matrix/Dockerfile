# syntax=docker/dockerfile:1
# Matrix image: every Discord bot + both LLM inference services in one
# container, sized for a single Fly performance-8x machine (8 dedicated
# cores / 16 GB RAM). Processes are supervised by deploy/matrix/run.mjs.

# ---- stage 1: install + build all TypeScript bots ----
FROM node:20-bookworm-slim AS bots
WORKDIR /build
COPY discord-aibot discord-aibot/
COPY soundproof soundproof/
COPY lkeff-listen lkeff-listen/
COPY airhornbot airhornbot/
COPY lastfm-client lastfm-client/
COPY modbot modbot/
RUN set -e; for p in discord-aibot soundproof lkeff-listen airhornbot lastfm-client modbot; do \
      cd "/build/$p" \
      && npm install --no-audit --fund=false \
      && npm run build \
      && npm prune --omit=dev; \
    done

# ---- final: node + python3.11 + one shared LLM venv ----
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip libgomp1 libsndfile1 \
 && rm -rf /var/lib/apt/lists/*

# Shared venv for both inference services (one torch install, CPU wheels).
RUN python3 -m venv /opt/llm-venv \
 && /opt/llm-venv/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/llm-venv/bin/pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
COPY services/mental-health/requirements.txt /tmp/mh-req.txt
COPY services/audio-events/requirements.txt /tmp/ae-req.txt
RUN /opt/llm-venv/bin/pip install --no-cache-dir -r /tmp/mh-req.txt -r /tmp/ae-req.txt

COPY services/mental-health /app/services/mental-health
COPY services/audio-events /app/services/audio-events
COPY services/conversation-graph /app/services/conversation-graph
COPY --from=bots /build /app/bots
COPY deploy/matrix/run.mjs /app/run.mjs

WORKDIR /app
ENV NODE_ENV=production \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/app/.cache/huggingface

RUN useradd -r -u 1001 matrix \
 && mkdir -p /app/data /app/.cache/huggingface \
 && chown -R matrix:matrix /app
USER matrix

EXPOSE 3000
CMD ["node", "run.mjs"]
