#!/bin/bash
set -e

echo "=== Building speech-to-text images ==="

# Build Rust backend
echo "Building speech-to-text backend..."
docker build -t localhost:5000/speech-to-text:latest -f Dockerfile .

echo "Pushing backend to local registry..."
docker push localhost:5000/speech-to-text:latest

# Build Whisper (includes model, ~1.5GB download during build)
echo ""
echo "Building Whisper image (this will download the model, ~1.5GB)..."
docker build -t localhost:5000/speech-to-text-whisper:latest -f Dockerfile.whisper .

echo "Pushing Whisper to local registry..."
docker push localhost:5000/speech-to-text-whisper:latest

echo ""
echo "=== Build complete! ==="
echo ""
kubectl apply -f k8s/
kubectl rollout restart deployment