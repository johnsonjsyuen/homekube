#!/bin/bash
set -eu

cd "$(dirname "$0")"

echo "Building OCR server..."
docker build -t localhost:5000/ocr-server:latest .
docker push localhost:5000/ocr-server:latest

echo "Deploying to Kubernetes..."
kubectl apply -f k8s/

echo "Restarting deployment..."
kubectl rollout restart deployment/ocr-server

echo "Done!"
