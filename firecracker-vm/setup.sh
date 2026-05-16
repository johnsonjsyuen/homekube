#!/bin/bash
set -euo pipefail

ARCH=$(uname -m)
echo "Detected architecture: $ARCH"

# Check dependencies
deps=(curl tar uname)
missing=()
for dep in "${deps[@]}"; do
  if ! command -v "$dep" &>/dev/null; then
    missing+=("$dep")
  fi
done
if [ ${#missing[@]} -ne 0 ]; then
  echo "Error: Missing required dependencies: ${missing[*]}"
  exit 1
fi

# Download Firecracker
echo "Fetching latest Firecracker version..."

# Try robust JSON parsing with Python3, fall back to grep if unavailable
if command -v python3 &>/dev/null; then
  LATEST_TAG=$(curl -fsSL https://api.github.com/repos/firecracker-microvm/firecracker/releases/latest | python3 -c "import sys, json; print(json.load(sys.stdin).get('tag_name','')")
else
  LATEST_TAG=$(curl -fsSL https://api.github.com/repos/firecracker-microvm/firecracker/releases/latest | grep -oP '"tag_name":\s*"\K[^"]+' | head -n 1)
fi

if [ -z "$LATEST_TAG" ]; then
    echo "Failed to fetch latest tag, defaulting to v1.7.0"
    LATEST_TAG="v1.7.0"
fi

echo "Downloading Firecracker $LATEST_TAG..."
FC_FILENAME="firecracker-${LATEST_TAG}-${ARCH}"
FC_URL="https://github.com/firecracker-microvm/firecracker/releases/download/${LATEST_TAG}/${FC_FILENAME}.tgz"

curl -fsSL -o firecracker.tgz "$FC_URL" || { echo "Download failed"; exit 1; }
tar -xzf firecracker.tgz
mv "release-${LATEST_TAG}-${ARCH}/${FC_FILENAME}" ./firecracker
chmod +x ./firecracker
rm -f firecracker.tgz
rm -rf "release-${LATEST_TAG}-${ARCH}"

# Set executable permissions for other scripts
chmod +x create_rootfs.sh
chmod +x launch.sh

echo "Setup complete."
echo "1. Run 'sudo ./create_rootfs.sh' to build the Ubuntu root filesystem and extract the kernel."
echo "2. Run 'sudo ./launch.sh' to start the VM."
