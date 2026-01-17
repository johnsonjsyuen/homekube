#!/bin/bash
set -e

ARCH=$(uname -m)
echo "Detected architecture: $ARCH"

# Download Firecracker
echo "Fetching latest Firecracker version..."
LATEST_TAG=$(curl -s https://api.github.com/repos/firecracker-microvm/firecracker/releases/latest | grep tag_name | cut -d '"' -f 4)

if [ -z "$LATEST_TAG" ]; then
    echo "Failed to fetch latest tag, defaulting to v1.7.0"
    LATEST_TAG="v1.7.0"
fi

echo "Downloading Firecracker $LATEST_TAG..."
FC_FILENAME="firecracker-${LATEST_TAG}-${ARCH}"
FC_URL="https://github.com/firecracker-microvm/firecracker/releases/download/${LATEST_TAG}/${FC_FILENAME}.tgz"

curl -L -o firecracker.tgz $FC_URL || { echo "Download failed"; exit 1; }
tar -xzf firecracker.tgz
mv release-${LATEST_TAG}-${ARCH}/${FC_FILENAME} ./firecracker
chmod +x ./firecracker
rm firecracker.tgz
rm -rf release-${LATEST_TAG}-${ARCH}

# Set executable permissions for other scripts
chmod +x create_rootfs.sh
chmod +x launch.sh

echo "Setup complete."
echo "1. Run 'sudo ./create_rootfs.sh' to build the Ubuntu root filesystem and extract the kernel."
echo "2. Run 'sudo ./launch.sh' to start the VM."
