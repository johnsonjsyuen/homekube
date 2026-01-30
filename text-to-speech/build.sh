#!/bin/bash

set -eu

# Ensure we are building from the directory containing this script
cd "$(dirname "$0")"

echo "Building Docker image..."
# Using linux/amd64 as per other services
docker build --platform linux/amd64 . -t localhost:5000/text-to-speech:latest

echo "Pushing to local registry..."
docker push localhost:5000/text-to-speech:latest

echo "Applying Kubernetes manifests..."
kubectl apply -f k8s/

echo "Restarting pods to pull new image..."
kubectl rollout restart deployment text-to-speech
