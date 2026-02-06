#!/bin/bash
set -e

echo "=== Building speech-to-text images ==="

# Build Rust backend
echo "Building speech-to-text backend..."
docker build -t localhost:5000/speech-to-text:latest -f Dockerfile .

echo "Pushing backend to local registry..."
docker push localhost:5000/speech-to-text:latest

# Build vLLM (small image, model loaded from PVC)
echo ""
echo "Building vLLM image (model loaded from PVC)..."
docker build -t localhost:5000/speech-to-text-vllm:latest -f Dockerfile.vllm .

echo "Pushing vLLM to local registry..."
docker push localhost:5000/speech-to-text-vllm:latest

echo ""
echo "=== Build complete! ==="
echo ""
echo "Before deploying, copy model files to PVC:"
echo "  1. kubectl apply -f k8s/pvc.yaml"
echo "  2. See instructions in UPLOAD_MODEL.md"
echo ""
echo "Then deploy with: kubectl apply -f k8s/"
