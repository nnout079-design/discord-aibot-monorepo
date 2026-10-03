#!/usr/bin/env bash
set -euo pipefail

# Deploy every Fly.io app in the monorepo.
# Usage: ./deploy-fly.sh [app]
# Example: ./deploy-fly.sh mental-health

APPS=(
  "services/mental-health"
  "discord-aibot"
  "soundproof"
  "lkeff-listen"
  "airhornbot"
  "lastfm-client"
)

if [ $# -eq 1 ]; then
  app="$1"
  if [ ! -f "${app}/fly.toml" ]; then
    echo "No fly.toml found at ${app}/fly.toml"
    exit 1
  fi
  echo "Deploying ${app}..."
  fly deploy --config "${app}/fly.toml" "${app}"
else
  for app in "${APPS[@]}"; do
    echo "Deploying ${app}..."
    fly deploy --config "${app}/fly.toml" "${app}"
  done
fi
