#!/bin/bash
set -eu

cd "$(dirname "$0")"

echo "Building Docker image..."
docker build --platform linux/amd64 . -t localhost:5000/workflows-worker:latest

echo "Pushing to local registry..."
docker push localhost:5000/workflows-worker:latest

echo "Applying Kubernetes manifests..."
kubectl apply -f k8s/

echo "Restarting pods to pull new image..."
kubectl rollout restart deployment workflows-worker -n temporal

echo "Waiting for rollout to complete..."
kubectl rollout status deployment workflows-worker -n temporal --timeout=120s
