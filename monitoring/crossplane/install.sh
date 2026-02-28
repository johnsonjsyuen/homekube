#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NAMESPACE="crossplane-system"

# 1. Install Crossplane via Helm
echo "==> Installing Crossplane..."
helm repo add crossplane-stable https://charts.crossplane.io/stable
helm repo update
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
helm upgrade --install crossplane crossplane-stable/crossplane \
  --namespace "$NAMESPACE" \
  --wait

# 2. Install Grafana provider
echo "==> Installing Grafana provider..."
kubectl apply -f "$SCRIPT_DIR/provider.yaml"
echo "Waiting for provider to become healthy..."
kubectl wait provider/provider-grafana --for=condition=Healthy --timeout=300s

# 3. Create credentials secret and provider config
echo "==> Applying provider config..."
if ! kubectl -n "$NAMESPACE" get secret grafana-crossplane-credentials &>/dev/null; then
  echo "ERROR: Secret 'grafana-crossplane-credentials' not found in $NAMESPACE."
  echo "Run create-secret.sh first: ./create-secret.sh <grafana-admin-password>"
  exit 1
fi
kubectl apply -f "$SCRIPT_DIR/provider-config.yaml"

# 4. Create Grafana folder
echo "==> Creating Grafana folder..."
kubectl apply -f "$SCRIPT_DIR/folder.yaml"
echo "Waiting for folder to become ready..."
kubectl wait folder.oss.grafana.crossplane.io/homekube --for=condition=Ready --timeout=120s

# 5. Apply all dashboards
echo "==> Applying dashboards..."
kubectl apply -f "$SCRIPT_DIR/dashboards/"
echo "Waiting for dashboards to become ready..."
kubectl wait dashboard.oss.grafana.crossplane.io --all --for=condition=Ready --timeout=120s

echo "==> Done! Verify with:"
echo "  kubectl get providers"
echo "  kubectl get folder.oss.grafana.crossplane.io"
echo "  kubectl get dashboard.oss.grafana.crossplane.io"
