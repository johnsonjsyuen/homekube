#!/bin/bash
set -e

# Instructions
echo "This script helps you register a Forgejo runner and create the Kubernetes Secret."
echo "You need a Forgejo instance URL and a Registration Token."
echo "You can get the token from your Forgejo instance: Site Administration -> Actions -> Runners -> Create new Runner."

read -p "Forgejo Instance URL (e.g., https://code.example.com): " INSTANCE_URL
read -p "Registration Token: " TOKEN
read -p "Runner Name (default: k8s-runner): " RUNNER_NAME
RUNNER_NAME=${RUNNER_NAME:-k8s-runner}

read -p "Runner Labels (comma-separated, e.g., ubuntu-latest:docker://ubuntu:latest): " LABELS
# Default labels if empty
if [ -z "$LABELS" ]; then
    LABELS="ubuntu-latest:docker://node:20-bookworm:docker://ubuntu:latest"
fi

echo "Registering runner..."

# Run the registration using docker
# We mount the current directory to /data to get the .runner file
nerdctl run --rm -v "$PWD":/data code.forgejo.org/forgejo/runner:3.3.0 forgejo-runner register \
  --instance "$INSTANCE_URL" \
  --token "$TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "$LABELS" \
  --no-interactive

if [ -f ".runner" ]; then
    echo "Registration successful. .runner file created."
    echo "Creating Kubernetes Secret..."

    # Create the secret
    kubectl create secret generic forgejo-runner-secret --from-file=.runner=./.runner --dry-run=client -o yaml | kubectl apply -f -

    echo "Secret 'forgejo-runner-secret' created/updated."
    echo "You can now deploy the runner: kubectl apply -f k8s/"
else
    echo "Registration failed. .runner file not found."
    exit 1
fi
