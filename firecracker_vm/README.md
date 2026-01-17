# Firecracker Ubuntu VM for AI Agents

This directory contains scripts to set up and launch a Firecracker MicroVM running Ubuntu 22.04 LTS. This environment is suitable for AI agent development, providing an isolated and fast-booting Linux environment.

## Prerequisites

- **Host OS**: Linux (x86_64)
- **Virtualization**: KVM enabled (check with `kvm-ok` or `ls /dev/kvm`)
- **Dependencies**:
  - `docker` (for building the rootfs)
  - `sudo` (for setting up networking)
  - `curl`, `tar`, `iproute2`, `iptables`
  - `sshpass` (optional, for the python example script)

## Quick Start

1. **Setup Binaries**:
   Download Firecracker.
   ```bash
   ./setup.sh
   ```

2. **Build Root Filesystem & Kernel**:
   Create the Ubuntu 22.04 root filesystem image and extract the compatible kernel. This uses Docker to pull the image, install the kernel and necessary packages (Python, SSH, etc.).
   ```bash
   sudo ./create_rootfs.sh
   ```

3. **Launch the VM**:
   Start the Firecracker VM.
   ```bash
   sudo ./launch.sh
   ```
   The VM will boot and output logs to the console. It sets up a network tap device `tap0` with IP `172.16.0.1` (host) and assigns `172.16.0.2` to the VM.

## Connecting to the VM

The VM runs an OpenSSH server. You can connect using:

```bash
ssh root@172.16.0.2
# Password: root
```

### For AI Agents

An example Python script `agent_connect.py` is provided to demonstrate how an AI agent can connect to the VM and execute commands.

1. Install `sshpass` (if using password auth):
   ```bash
   sudo apt install sshpass
   ```

2. Run the agent script (while the VM is running):
   ```bash
   python3 agent_connect.py
   ```

### Synchronizing Code

You can use the `agent_sync.py` script to copy the repository into the VM, let the agent work, and then copy the changes back.

1. **Push** the repository to the VM:
   ```bash
   python3 agent_sync.py push
   ```
   This copies the current repository (excluding artifacts) to `/root/workspace` inside the VM.

2. **Work** inside the VM.

3. **Pull** the changes back to the host:
   ```bash
   python3 agent_sync.py pull
   ```
   This overwrites local files with the versions from the VM.

## Customization

- **Packages**: Edit `create_rootfs.sh` to add more packages to the `docker exec ... apt-get install` command.
- **Network**: Edit `launch.sh` to change IP addresses or network interfaces.
- **Kernel**: The `create_rootfs.sh` script extracts the `linux-image-kvm` kernel and initrd from the Ubuntu container. This ensures compatibility with the Ubuntu userland and Firecracker.

## Troubleshooting

- **Permissions**: Ensure you run `create_rootfs.sh` and `launch.sh` with `sudo`.
- **KVM**: If Firecracker fails with "KVM not found", ensure your user has access to `/dev/kvm` or virtualization is enabled in BIOS.
- **Networking**: If the VM cannot access the internet, check the `iptables` rules in `launch.sh` and ensure your host's default interface is correctly detected.
