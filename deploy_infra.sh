#!/bin/bash
set -e

echo "=== Deploying infrastructure ==="

# NATS JetStream
echo "--- NATS JetStream ---"
kubectl apply -f nats/k8s/config.yaml -f nats/k8s/pvc.yaml -f nats/k8s/deployment.yaml -f nats/k8s/service.yaml -f nats/k8s/service-temporal.yaml
kubectl rollout status deployment/nats --timeout=60s
kubectl delete job nats-init-streams --ignore-not-found
kubectl apply -f nats/k8s/init-streams.yaml
kubectl wait --for=condition=complete job/nats-init-streams --timeout=60s

# Keycloak
echo "--- Keycloak ---"
kubectl apply -f keycloak/k8s/namespace.yaml
kubectl apply -f keycloak/k8s/db.yaml -f keycloak/k8s/secret.yaml -f keycloak/k8s/service.yaml -f keycloak/k8s/deployment.yaml

# Forgejo Runner
echo "--- Forgejo Runner ---"
kubectl apply -f forgejo-runner/k8s/

# Speedtest
echo "--- Speedtest ---"
kubectl apply -f speedtest/k8s/

# Temporal (namespace + DB only, Temporal itself is Helm-managed)
echo "--- Temporal DB ---"
kubectl apply -f temporal/k8s/namespace.yaml
kubectl apply -f temporal/k8s/db.yaml

# Monitoring (Helm + grafana-proxy)
echo "--- Monitoring ---"
./monitoring/install.sh
kubectl apply -f monitoring/grafana-proxy/

echo "=== Infrastructure deployed ==="
