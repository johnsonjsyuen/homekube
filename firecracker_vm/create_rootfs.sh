#!/bin/bash
set -e

IMAGE="ubuntu-rootfs.ext4"
KERNEL_OUT="ubuntu-vmlinux.bin"
INITRD_OUT="ubuntu-initrd.img"
SIZE="3072" # 3GB
DOCKER_IMAGE="ubuntu:22.04"
CONTAINER_NAME="firecracker_ubuntu_builder"

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (or with sudo)"
  exit 1
fi

echo "Cleaning up previous runs..."
docker rm -f $CONTAINER_NAME 2>/dev/null || true
rm -f $IMAGE $KERNEL_OUT $INITRD_OUT

echo "Starting Docker container..."
docker run -it -d --name $CONTAINER_NAME $DOCKER_IMAGE /bin/bash

echo "Installing packages..."
# Install linux-image-kvm which is optimized for virtual environments
docker exec $CONTAINER_NAME apt-get update
docker exec $CONTAINER_NAME apt-get install -y \
    openssh-server python3 curl iproute2 net-tools nano udev systemd \
    linux-image-kvm sudo kmod rsync

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
docker cp netplan_config.yaml $CONTAINER_NAME:/etc/netplan/01-netcfg.yaml
rm netplan_config.yaml

echo "Setting root password..."
docker exec $CONTAINER_NAME sh -c 'echo "root:root" | chpasswd'

echo "Configuring SSH..."
docker exec $CONTAINER_NAME sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config
docker exec $CONTAINER_NAME ssh-keygen -A

echo "Fixing systemd for VM..."
# Unmask services masked by Docker image
docker exec $CONTAINER_NAME bash -c '
for i in $(grep -l "/dev/null" /etc/systemd/system/*.service /lib/systemd/system/*.service 2>/dev/null); do
  echo "Removing mask: $i"
  rm "$i"
done
'

# Enable serial console
docker exec $CONTAINER_NAME bash -c '
mkdir -p /etc/systemd/system/getty.target.wants
ln -sf /lib/systemd/system/serial-getty@.service /etc/systemd/system/getty.target.wants/serial-getty@ttyS0.service
'

# Create fstab
docker exec $CONTAINER_NAME bash -c 'echo "/dev/vda / ext4 defaults 0 0" > /etc/fstab'

echo "Extracting Kernel and Initrd..."
# Look for vmlinuz and initrd.img in /boot
KERNEL_PATH=$(docker exec $CONTAINER_NAME sh -c 'ls /boot/vmlinuz-* | head -n 1')
INITRD_PATH=$(docker exec $CONTAINER_NAME sh -c 'ls /boot/initrd.img-* | head -n 1')

echo "Found kernel: $KERNEL_PATH"
echo "Found initrd: $INITRD_PATH"

if [ -z "$KERNEL_PATH" ] || [ -z "$INITRD_PATH" ]; then
    echo "Error: Kernel or Initrd not found in /boot"
    exit 1
fi

docker cp $CONTAINER_NAME:$KERNEL_PATH ./$KERNEL_OUT
docker cp $CONTAINER_NAME:$INITRD_PATH ./$INITRD_OUT

# Change ownership of artifacts
if [ ! -z "$SUDO_USER" ]; then
    chown $SUDO_USER:$SUDO_USER $KERNEL_OUT $INITRD_OUT
fi

echo "Exporting filesystem..."
docker export $CONTAINER_NAME > ubuntu.tar

echo "Creating ext4 image..."
dd if=/dev/zero of=$IMAGE bs=1M count=$SIZE
mkfs.ext4 $IMAGE

echo "Copying files to image..."
mkdir -p /tmp/ubuntu_mount
mount $IMAGE /tmp/ubuntu_mount
tar -xvf ubuntu.tar -C /tmp/ubuntu_mount

echo "Cleanup..."
umount /tmp/ubuntu_mount
rm -rf /tmp/ubuntu_mount
rm ubuntu.tar
docker rm -f $CONTAINER_NAME

if [ ! -z "$SUDO_USER" ]; then
    chown $SUDO_USER:$SUDO_USER $IMAGE
fi

echo "Rootfs created: $IMAGE"
echo "Kernel extracted: $KERNEL_OUT"
echo "Initrd extracted: $INITRD_OUT"
