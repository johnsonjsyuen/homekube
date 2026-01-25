#!/bin/bash
set -e

# Change to repository root
REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

CLUSTER_NAME="integration-test"
KUBECTL="kubectl"
KIND="kind"
DOCKER="docker"

log() {
    echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] $@"
}

cleanup() {
    log "Cleaning up background processes..."
    kill $(jobs -p) 2>/dev/null || true
}
trap cleanup EXIT

check_dependencies() {
    log "Checking dependencies..."
    if ! command -v $KIND &> /dev/null; then
        echo "kind is not installed. Please install it."
        exit 1
    fi
    if ! command -v $KUBECTL &> /dev/null; then
        echo "kubectl is not installed. Please install it."
        exit 1
    fi
    if ! command -v $DOCKER &> /dev/null; then
        echo "docker is not installed. Please install it."
        exit 1
    fi
}

create_cluster() {
    log "Creating Kind cluster '$CLUSTER_NAME'..."
    if $KIND get clusters | grep -q "^$CLUSTER_NAME$"; then
        log "Cluster '$CLUSTER_NAME' already exists. Using it."
    else
        $KIND create cluster --name "$CLUSTER_NAME"
    fi
    $KUBECTL cluster-info --context "kind-$CLUSTER_NAME"
}

install_cnpg() {
    log "Installing CloudNativePG operator..."
    # Using 1.28.0 as identified
    $KUBECTL apply --server-side -f https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.28/releases/cnpg-1.28.0.yaml

    log "Waiting for CloudNativePG operator to be ready..."
    $KUBECTL rollout status deployment -n cnpg-system cnpg-controller-manager --timeout=300s
}

test_homepage() {
    log "Testing Homepage app..."

    log "Building Homepage image..."
    $DOCKER build -t homepage:test ./homepage

    log "Loading Homepage image into Kind..."
    $KIND load docker-image homepage:test --name "$CLUSTER_NAME"

    log "Deploying Homepage..."
    $KUBECTL apply -f homepage/homepage-deployment.yaml

    # Patch image and pull policy
    $KUBECTL set image deployment/homepage homepage=homepage:test
    $KUBECTL patch deployment homepage -p '{"spec":{"template":{"spec":{"containers":[{"name":"homepage","imagePullPolicy":"Never"}]}}}}'

    log "Waiting for Homepage deployment rollout..."
    $KUBECTL rollout status deployment/homepage --timeout=120s

    log "Verifying Homepage availability..."
    # Port forward to random port
    local port=30080

    $KUBECTL port-forward svc/homepage $port:80 > /dev/null 2>&1 &
    local pid=$!

    sleep 10 # Give port-forward some time
    if curl -s "http://localhost:$port" > /dev/null; then
        log "Homepage is accessible."
    else
        log "Failed to access Homepage."
        exit 1
    fi
    # Process killed by trap or explicitly
    kill $pid
}

test_speedtest() {
    log "Testing Speedtest app..."

    log "Building Speedtest image..."
    $DOCKER build -t speedtest:test ./speedtest

    log "Loading Speedtest image into Kind..."
    $KIND load docker-image speedtest:test --name "$CLUSTER_NAME"

    log "Deploying Speedtest Postgres Cluster..."
    $KUBECTL apply -f speedtest/k8s/postgres-cluster.yaml

    log "Waiting for Postgres Cluster to be ready..."
    $KUBECTL wait --for=condition=Ready cluster/speedtest-db --timeout=300s

    log "Deploying Speedtest App..."
    $KUBECTL apply -f speedtest/k8s/service.yaml
    $KUBECTL apply -f speedtest/k8s/deployment.yaml

    # Patch image and pull policy
    $KUBECTL set image deployment/speedtest speedtest=speedtest:test
    $KUBECTL patch deployment speedtest -p '{"spec":{"template":{"spec":{"containers":[{"name":"speedtest","imagePullPolicy":"Never"}]}}}}'

    log "Waiting for Speedtest deployment rollout..."
    $KUBECTL rollout status deployment/speedtest --timeout=120s

    log "Verifying Speedtest availability..."
    local port=30081

    $KUBECTL port-forward svc/speedtest $port:80 > /dev/null 2>&1 &
    local pid=$!

    sleep 10
    if curl -s "http://localhost:$port" > /dev/null; then
        log "Speedtest app is accessible."
    else
        log "Failed to access Speedtest app."
        exit 1
    fi
    kill $pid
}

main() {
    check_dependencies
    create_cluster
    install_cnpg
    test_homepage
    test_speedtest

    log "Integration tests passed successfully!"
}

main
