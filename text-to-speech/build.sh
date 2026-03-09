#!/bin/bash

set -eu

# Ensure we are building from the directory containing this script
cd "$(dirname "$0")"

echo "Building Docker image..."
docker build --platform linux/amd64 . -t localhost:5000/text-to-speech:latest

echo "Pushing to local registry..."
docker push localhost:5000/text-to-speech:latest

echo "Applying Kubernetes manifests..."
kubectl apply -f k8s/

echo "Running model download job (if needed)..."
kubectl delete job tts-model-init --ignore-not-found
kubectl apply -f k8s/model-job.yaml
kubectl wait --for=condition=complete job/tts-model-init --timeout=300s

echo "Restarting deployments..."
kubectl rollout restart deployment tts-api
kubectl rollout restart deployment tts-worker
