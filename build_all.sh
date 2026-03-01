#!/bin/bash
set -e

services=(homepage text-to-speech speech-to-text whatsapp news-worker claude-code claude-code-api web-scraper-kt)
pids=()
failures=()

for svc in "${services[@]}"; do
  echo "Building ${svc}..."
  (cd "$svc" && ./build.sh) &
  pids+=($!)
done

for i in "${!pids[@]}"; do
  if ! wait "${pids[$i]}"; then
    failures+=("${services[$i]}")
  fi
done

if [ ${#failures[@]} -gt 0 ]; then
  echo "Build FAILED for: ${failures[*]}"
  exit 1
fi

echo "All builds completed successfully!"
