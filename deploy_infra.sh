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

# GitHub Token for Claude Code API
# Required so the claude-code-api pod can use `gh` CLI for PRs, issues, etc.
# The token is a GitHub Personal Access Token with appropriate scopes (e.g. repo, read:org).
echo "--- GitHub Token (Claude Code API) ---"
if kubectl get secret github-token -n default &>/dev/null; then
  echo "Secret 'github-token' already exists, skipping."
else
  echo "Secret 'github-token' not found."
  echo "Create it manually with:"
  echo ""
  echo "  kubectl create secret generic github-token --from-literal=token=ghp_YOUR_PERSONAL_ACCESS_TOKEN"
  echo ""
  echo "Skipping for now."
fi

echo "=== Infrastructure deployed ==="
