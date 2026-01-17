#!/bin/bash

set -eu

# Ensure we are building from the directory containing this script
cd "$(dirname "$0")"

echo "Building fresh Docker image (no-cache)..."
docker build --platform linux/amd64 . -t localhost:5001/speedtest:latest

echo "Pushing to local registry..."
docker push localhost:5001/speedtest:latest

echo "Applying Kubernetes manifests..."
kubectl apply -f k8s/

echo "Restarting pods to pull new image..."
kubectl rollout restart deployment speedtest
