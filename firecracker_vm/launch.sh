#!/bin/bash
set -e

# Configuration
TAP_DEV="tap0"
TAP_IP="172.16.0.1"
MASK_SHORT="/24"
KERNEL="ubuntu-vmlinux.bin"
INITRD="ubuntu-initrd.img"
ROOTFS="ubuntu-rootfs.ext4"
FC_BINARY="./firecracker"
API_SOCKET="/tmp/firecracker.socket"

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (or with sudo)"
  exit 1
fi

if [ ! -f "$KERNEL" ]; then
    echo "Kernel file $KERNEL not found. Please run create_rootfs.sh."
    exit 1
fi

if [ ! -f "$INITRD" ]; then
    echo "Initrd file $INITRD not found. Please run create_rootfs.sh."
    exit 1
fi

if [ ! -f "$ROOTFS" ]; then
    echo "Rootfs $ROOTFS not found. Please run create_rootfs.sh."
    exit 1
fi

# Cleanup
rm -f $API_SOCKET

# Network Setup
echo "Setting up network..."
ip link del "$TAP_DEV" 2> /dev/null || true
ip tuntap add dev "$TAP_DEV" mode tap
ip addr add "${TAP_IP}${MASK_SHORT}" dev "$TAP_DEV"
ip link set dev "$TAP_DEV" up

# Enable forwarding
echo 1 > /proc/sys/net/ipv4/ip_forward

# Iptables
# Find default interface
DEFAULT_IFACE=$(ip route | grep default | awk '{print $5}')
if [ -z "$DEFAULT_IFACE" ]; then
    echo "Warning: Could not determine default interface. Internet access might not work."
else
    echo "Using outgoing interface: $DEFAULT_IFACE"
    iptables -t nat -D POSTROUTING -o $DEFAULT_IFACE -j MASQUERADE 2>/dev/null || true
    iptables -D FORWARD -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
    iptables -D FORWARD -i $TAP_DEV -o $DEFAULT_IFACE -j ACCEPT 2>/dev/null || true

    iptables -t nat -A POSTROUTING -o $DEFAULT_IFACE -j MASQUERADE
    iptables -I FORWARD 1 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
    iptables -I FORWARD 1 -i $TAP_DEV -o $DEFAULT_IFACE -j ACCEPT
fi

# Create Config
cat <<EOF > vm_config.json
{
  "boot-source": {
    "kernel_image_path": "$KERNEL",
    "initrd_path": "$INITRD",
    "boot_args": "console=ttyS0 reboot=k panic=1 pci=off init=/lib/systemd/systemd rw root=/dev/vda"
  },
  "drives": [
    {
      "drive_id": "rootfs",
      "path_on_host": "$ROOTFS",
      "is_root_device": true,
      "is_read_only": false
    }
  ],
  "machine-config": {
    "vcpu_count": 2,
    "mem_size_mib": 1024
  },
  "network-interfaces": [
    {
      "iface_id": "eth0",
      "guest_mac": "AA:FC:00:00:00:01",
      "host_dev_name": "$TAP_DEV"
    }
  ]
}
EOF

echo "Launching Firecracker..."
echo "To connect to the VM: ssh root@172.16.0.2 (password: root)"
$FC_BINARY --api-sock $API_SOCKET --config-file vm_config.json
