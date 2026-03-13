#!/bin/bash
set -eu

cd "$(dirname "$0")"

echo "Building Docker image..."
docker build --platform linux/amd64 . -t localhost:5000/location-share-server:latest

echo "Pushing to local registry..."
docker push localhost:5000/location-share-server:latest

echo "Applying Kubernetes manifests..."
kubectl apply -f k8s/

echo "Restarting pods to pull new image..."
kubectl rollout restart deployment location-share-server

echo "Waiting for rollout to complete..."
kubectl rollout status deployment location-share-server --timeout=120s
