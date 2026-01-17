#!/bin/bash

set -eu

docker build . -t localhost:5000/weather-service:latest
docker push localhost:5000/weather-service:latest
kubectl apply -f weatherhomepage/weather-deployment.yaml
kubectl rollout restart deployment weather-service
