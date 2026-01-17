#!/bin/bash

# Define registry name and port
REGISTRY_NAME="local-registry"
REGISTRY_PORT="5000"

echo "Starting Docker Registry on port $REGISTRY_PORT..."

# Check if the registry container is already running
if [ "$(docker ps -q -f name=$REGISTRY_NAME)" ]; then
    echo "Registry is already running."
else
    # Check if the container exists but is stopped
    if [ "$(docker ps -aq -f name=$REGISTRY_NAME)" ]; then
        echo "Restarting existing stopped registry container..."
        docker start $REGISTRY_NAME
    else
        # Run the registry
        docker run -d \
          -p $REGISTRY_PORT:5000 \
          --restart=always \
          --name $REGISTRY_NAME \
          registry:2
    fi

    if [ $? -eq 0 ]; then
        echo "Registry started successfully!"
        echo "You can access it at localhost:$REGISTRY_PORT"
    else
        echo "Failed to start registry."
        exit 1
    fi
fi
