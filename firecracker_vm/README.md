# Firecracker Ubuntu VM for AI Agents

This directory contains scripts to set up and launch a Firecracker MicroVM running Ubuntu 22.04 LTS. This environment is suitable for AI agent development, providing an isolated and fast-booting Linux environment.

## Prerequisites

- **Host OS**: Linux (x86_64)
- **Virtualization**: KVM enabled (check with `kvm-ok` or `ls /dev/kvm`)
- **Dependencies**:
  - `docker` (for building the rootfs)
  - `sudo` (for setting up networking)
  - `curl`, `tar`, `iproute2`, `iptables`, `rsync`, `sshpass`

## Quick Start

1. **Setup Binaries**:
   Download Firecracker.
   ```bash
   ./setup.sh
   ```

2. **Start the Agent Session**:
   The `agent_start.py` script manages the entire lifecycle. It will build the VM image (if missing), start the VM, and push the repository code into it.
   ```bash
   python3 agent_start.py
   ```
   *Note: This requires `sudo` internally for network setup and Docker operations. Ensure your user has sudo privileges.*

3. **Work**:
   The agent or user can now connect to the VM and work on the code in `/root/workspace`.
   ```bash
   sshpass -p root ssh root@172.16.0.2
   ```

4. **Sync Changes**:
   To pull changes made inside the VM back to the host:
   ```bash
   python3 agent_start.py sync
   ```

5. **Stop**:
   To pull changes and shut down the VM:
   ```bash
   python3 agent_start.py stop
   ```

## Manual Steps (Advanced)

If you prefer to run steps manually:

1. **Build Rootfs**: `sudo ./create_rootfs.sh`
2. **Launch VM**: `sudo ./launch.sh`
3. **Connect**: `ssh root@172.16.0.2` (password: root)

## Customization

- **Packages**: Edit `create_rootfs.sh` to add more packages to the `docker exec ... apt-get install` command.
- **Network**: Edit `launch.sh` to change IP addresses or network interfaces.
- **Kernel**: The `create_rootfs.sh` script extracts the `linux-image-kvm` kernel and initrd from the Ubuntu container. This ensures compatibility with the Ubuntu userland and Firecracker.

## Troubleshooting

- **Permissions**: Ensure you run `create_rootfs.sh` and `launch.sh` with `sudo`.
- **KVM**: If Firecracker fails with "KVM not found", ensure your user has access to `/dev/kvm` or virtualization is enabled in BIOS.
- **Networking**: If the VM cannot access the internet, check the `iptables` rules in `launch.sh` and ensure your host's default interface is correctly detected.
