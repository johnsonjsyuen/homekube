#!/usr/bin/env bash
set -euo pipefail

# Create the Grafana credentials secret for Crossplane in the crossplane-system namespace
# Usage: ./create-secret.sh <grafana-admin-password>

if [ -z "$1" ]; then
  echo "Usage: $0 <grafana-admin-password>"
  exit 1
fi

kubectl -n crossplane-system create secret generic grafana-crossplane-credentials \
  --from-literal=credentials='{"url":"http://kube-prometheus-stack-grafana.monitoring.svc.cluster.local","auth":"admin:'"$1"'"}' \
  --dry-run=client -o yaml | kubectl apply -f -
