#!/bin/bash
set -eu

cd "$(dirname "$0")"

echo "Building Docker image..."
docker build --platform linux/amd64 . -t localhost:5000/news-worker:latest

echo "Pushing to local registry..."
docker push localhost:5000/news-worker:latest

echo "Applying Kubernetes manifests..."
kubectl apply -f k8s/

echo "Restarting pods to pull new image..."
kubectl rollout restart deployment news-worker -n temporal

echo "Waiting for rollout to complete..."
kubectl rollout status deployment news-worker -n temporal --timeout=120s

echo "Registering Temporal schedules..."
kubectl port-forward -n temporal svc/temporal-frontend 7233:7233 &
PF_PID=$!
sleep 2
TEMPORAL_ADDRESS=localhost:7233 npm run register-schedule
kill $PF_PID 2>/dev/null || true
