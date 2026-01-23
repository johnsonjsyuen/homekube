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

# Check for docker
if ! command -v docker &> /dev/null; then
    echo "Error: 'docker' CLI not found."
    echo "Please install Docker."
    exit 1
fi

DB_CONTAINER_NAME="speedtest-postgres-local"
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=speedtest

echo "1. Starting Postgres container..."
# Remove existing container if it exists
docker rm -f $DB_CONTAINER_NAME 2>/dev/null || true

# Start new container
docker run -d \
    --name $DB_CONTAINER_NAME \
    -e POSTGRES_USER=$DB_USER \
    -e POSTGRES_PASSWORD=$DB_PASSWORD \
    -e POSTGRES_DB=$DB_NAME \
    -p $DB_PORT:5432 \
    postgres:15-alpine > /dev/null

echo "Postgres container started ($DB_CONTAINER_NAME)"

# Ensure we stop the container when the script exits
cleanup() {
    echo "Stopping Postgres container..."
    docker stop $DB_CONTAINER_NAME > /dev/null
    docker rm $DB_CONTAINER_NAME > /dev/null
    echo "Done."
}
trap cleanup EXIT

echo "Waiting for Postgres to be ready..."
until docker exec $DB_CONTAINER_NAME pg_isready -U $DB_USER > /dev/null 2>&1; do
    sleep 1
done
echo "Postgres is ready."

echo "2. Starting application..."
export DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@localhost:${DB_PORT}/${DB_NAME}"
export PORT=3001

echo "Running on http://localhost:$PORT"
cargo run
