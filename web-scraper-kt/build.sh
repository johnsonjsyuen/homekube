#!/bin/bash
set -eu

cd "$(dirname "$0")"

echo "Building Docker image..."
docker build --platform linux/amd64 . -t localhost:5000/web-scraper:latest

echo "Pushing to local registry..."
docker push localhost:5000/web-scraper:latest

echo "Applying Kubernetes manifests..."
kubectl apply -f k8s/

echo "Restarting pods to pull new image..."
kubectl rollout restart deployment web-scraper -n temporal

echo "Waiting for rollout to complete..."
kubectl rollout status deployment web-scraper -n temporal --timeout=120s
