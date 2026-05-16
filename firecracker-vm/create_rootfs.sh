#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

IMAGE="ubuntu-rootfs.ext4"
KERNEL_OUT="ubuntu-vmlinux.bin"
INITRD_OUT="ubuntu-initrd.img"
SIZE="3072" # 3GB
DOCKER_IMAGE="ubuntu:22.04"
CONTAINER_NAME="firecracker_ubuntu_builder"
MOUNT_DIR="/tmp/ubuntu_mount"

if [ "${EUID:-0}" -ne 0 ]; then
  echo "Please run as root (or with sudo)"
  exit 1
fi

# Ensure mount point is cleaned up on exit or interrupt
cleanup_mount() {
  if mountpoint -q "$MOUNT_DIR" 2>/dev/null; then
    umount "$MOUNT_DIR" || true
  fi
  rm -rf "$MOUNT_DIR"
}
trap cleanup_mount EXIT INT TERM

echo "Cleaning up previous runs..."
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
rm -f "$IMAGE" "$KERNEL_OUT" "$INITRD_OUT"

echo "Starting Docker container..."
docker run -d --name "$CONTAINER_NAME" "$DOCKER_IMAGE" /bin/bash

echo "Installing packages..."
docker exec "$CONTAINER_NAME" apt-get update

# Try linux-image-kvm first (optimized for VMs), fall back to linux-image-generic
if ! docker exec "$CONTAINER_NAME" apt-get install -y linux-image-kvm 2>/dev/null; then
  echo "linux-image-kvm not available, falling back to linux-image-generic..."
  docker exec "$CONTAINER_NAME" apt-get install -y linux-image-generic
fi

docker exec "$CONTAINER_NAME" apt-get install -y \
    openssh-server python3 curl iproute2 net-tools nano udev systemd \
    sudo kmod rsync netplan.io binutils

echo "Configuring network..."
cat <<EOF > netplan_config.yaml
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: no
      addresses: [172.16.0.2/24]
      routes:
        - to: default
          via: 172.16.0.1
      nameservers:
        addresses: [8.8.8.8]
EOF
docker cp netplan_config.yaml "$CONTAINER_NAME":/etc/netplan/01-netcfg.yaml
rm -f netplan_config.yaml

echo "Setting root password..."
docker exec "$CONTAINER_NAME" sh -c 'echo "root:root" | chpasswd'

echo "Configuring SSH..."
docker exec "$CONTAINER_NAME" sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config
docker exec "$CONTAINER_NAME" ssh-keygen -A

# Inject SSH public key if present
SSH_KEY="${SCRIPT_DIR}/id_firecracker.pub"
if [ -f "$SSH_KEY" ]; then
    echo "Injecting SSH public key..."
    docker exec "$CONTAINER_NAME" mkdir -p /root/.ssh
    docker cp "$SSH_KEY" "$CONTAINER_NAME":/root/.ssh/authorized_keys
    docker exec "$CONTAINER_NAME" chmod 700 /root/.ssh
    docker exec "$CONTAINER_NAME" chmod 600 /root/.ssh/authorized_keys
fi

echo "Fixing systemd for VM..."
# Unmask services masked by Docker image
docker exec "$CONTAINER_NAME" bash -c '
for i in $(grep -l "/dev/null" /etc/systemd/system/*.service /lib/systemd/system/*.service 2>/dev/null); do
  echo "Removing mask: $i"
  rm "$i"
done
'

# Enable serial console
docker exec "$CONTAINER_NAME" bash -c '
mkdir -p /etc/systemd/system/getty.target.wants
ln -sf /lib/systemd/system/serial-getty@.service /etc/systemd/system/getty.target.wants/serial-getty@ttyS0.service
'

# Create fstab
docker exec "$CONTAINER_NAME" bash -c 'echo "/dev/vda / ext4 defaults 0 0" > /etc/fstab'

echo "Extracting Kernel and Initrd..."
# Look for vmlinuz and initrd.img in /boot
KERNEL_Z_PATH=$(docker exec "$CONTAINER_NAME" sh -c 'ls /boot/vmlinuz-* | head -n 1')
INITRD_PATH=$(docker exec "$CONTAINER_NAME" sh -c 'ls /boot/initrd.img-* | head -n 1')

echo "Found compressed kernel: $KERNEL_Z_PATH"
echo "Found initrd: $INITRD_PATH"

if [ -z "$KERNEL_Z_PATH" ] || [ -z "$INITRD_PATH" ]; then
    echo "Error: Kernel or Initrd not found in /boot"
    exit 1
fi

# Extract vmlinux from vmlinuz
echo "Obtaining extract-vmlinux script..."
if ! docker exec "$CONTAINER_NAME" test -f /usr/local/bin/extract-vmlinux; then
  docker exec "$CONTAINER_NAME" curl -fsSL https://raw.githubusercontent.com/torvalds/linux/master/scripts/extract-vmlinux -o /usr/local/bin/extract-vmlinux
  docker exec "$CONTAINER_NAME" chmod +x /usr/local/bin/extract-vmlinux
fi

echo "Extracting vmlinux..."
docker exec "$CONTAINER_NAME" sh -c "/usr/local/bin/extract-vmlinux $KERNEL_Z_PATH > /boot/vmlinux"
KERNEL_PATH="/boot/vmlinux"

docker cp "$CONTAINER_NAME":"$KERNEL_PATH" ./"$KERNEL_OUT"
docker cp "$CONTAINER_NAME":"$INITRD_PATH" ./"$INITRD_OUT"

# Change ownership of artifacts
if [ -n "${SUDO_USER:-}" ]; then
    chown "$SUDO_USER":"$SUDO_USER" "$KERNEL_OUT" "$INITRD_OUT"
fi

echo "Exporting filesystem..."
docker export "$CONTAINER_NAME" > ubuntu.tar

echo "Creating ext4 image..."
dd if=/dev/zero of="$IMAGE" bs=1M count="$SIZE"
mkfs.ext4 "$IMAGE"

echo "Copying files to image..."
mkdir -p "$MOUNT_DIR"
mount "$IMAGE" "$MOUNT_DIR"
tar -xf ubuntu.tar -C "$MOUNT_DIR"

echo "Cleanup..."
umount "$MOUNT_DIR"
rm -rf "$MOUNT_DIR"
rm -f ubuntu.tar
docker rm -f "$CONTAINER_NAME"

if [ -n "${SUDO_USER:-}" ]; then
    chown "$SUDO_USER":"$SUDO_USER" "$IMAGE"
fi

echo "Rootfs created: $IMAGE"
echo "Kernel extracted: $KERNEL_OUT"
echo "Initrd extracted: $INITRD_OUT"
