#!/bin/bash

set -eu

# Ensure we are building from the directory containing this script
cd "$(dirname "$0")"

echo "Building Docker image..."
docker build --platform linux/amd64 . -t localhost:5000/homepage:latest

echo "Pushing to local registry..."
docker push localhost:5000/homepage:latest

echo "Updating Kubernetes deployment..."
kubectl apply -f homepage-deployment.yaml

echo "Restarting pods to pull new image..."
kubectl rollout restart deployment homepage
