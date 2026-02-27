#!/bin/bash
# Create the Keycloak client secret for news-worker in the temporal namespace
# Usage: ./create-keycloak-secret.sh <client-secret>

if [ -z "$1" ]; then
  echo "Usage: $0 <client-secret>"
  exit 1
fi

kubectl -n temporal create secret generic news-worker-keycloak \
  --from-literal=client-secret="$1"
