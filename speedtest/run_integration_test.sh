#!/bin/bash

# Exit on error
set -e

# Check for speedtest CLI
if ! command -v speedtest &> /dev/null; then
    echo "Error: 'speedtest' CLI not found."
    echo "Please install it using: brew tap teamookla/speedtest && brew install speedtest"
    exit 1
fi

# Check if it's the Python version (wrong one)
if speedtest --version | grep -q "speedtest-cli"; then
    echo "Error: You have the Python 'speedtest-cli' installed."
    echo "This app requires the official Ookla 'speedtest' CLI."
    echo "Please run:"
    echo "  brew uninstall speedtest-cli"
    echo "  brew tap teamookla/speedtest"
    echo "  brew install speedtest --force"
    exit 1
fi

echo "1. Setting up port-forward to Postgres..."
# Kill any existing port-forward on 5432 to avoid conflicts
lsof -ti:5432 | xargs kill -9 2>/dev/null || true

# Start port-forward in background
kubectl port-forward service/speedtest-db-rw 5432:5432 > /dev/null 2>&1 &
PF_PID=$!
echo "Port-forward started (PID: $PF_PID)"

# Ensure we kill the port-forward when the script exits
trap "kill $PF_PID" EXIT

# Wait for port-forward to establish
echo "Waiting for connection..."
sleep 3

echo "2. Fetching database credentials..."
DB_PASSWORD=$(kubectl get secret speedtest-db-app-user -o jsonpath="{.data.password}" | base64 -d)
DB_USER=$(kubectl get secret speedtest-db-app-user -o jsonpath="{.data.username}" | base64 -d)

echo "3. Starting application..."
export DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@localhost:5432/speedtest"
export PORT=3001

echo "Running on http://localhost:$PORT"
cargo run
