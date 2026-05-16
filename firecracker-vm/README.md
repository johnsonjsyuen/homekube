# Firecracker Ubuntu VM for AI Agents

This directory contains scripts to set up and launch a Firecracker MicroVM running Ubuntu 22.04 LTS. This environment is suitable for AI agent development, providing an isolated and fast-booting Linux environment.

## Prerequisites

- **Host OS**: Linux (x86_64)
- **Virtualization**: KVM enabled (check with `kvm-ok` or `ls /dev/kvm`)
- **Dependencies**:
  - `docker` (for building the rootfs)
  - `sudo` (for setting up networking)
  - `curl`, `tar`, `iproute2`, `iptables`, `rsync`, `sshpass`
  - `python3` (for robust GitHub API parsing in setup.sh)

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

4. **Check Status**:
   To check if the VM is running and reachable:
   ```bash
   python3 agent_start.py status
   ```

5. **Sync Changes**:
   To pull changes made inside the VM back to the host:
   ```bash
   python3 agent_start.py sync
   ```

6. **Stop**:
   To pull changes and shut down the VM:
   ```bash
   python3 agent_start.py stop
   ```

## Configuration

You can override default settings via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `FC_VM_IP` | `172.16.0.2` | IP address of the VM |
| `FC_VM_USER` | `root` | SSH username |
| `FC_VM_PASS` | `root` | SSH password (used as fallback) |
| `FC_REMOTE_PATH` | `/root/workspace` | Path inside VM for code sync |
| `FC_HOST_PATH` | `..` (parent of script) | Host path to sync |

## SSH Key Authentication

For better security, the scripts support SSH key authentication:

1. Generate a dedicated key pair (done automatically during rootfs build if missing):
   ```bash
   ssh-keygen -t ed25519 -f firecracker-vm/id_firecracker -N ""
   ```

2. The `create_rootfs.sh` script will automatically inject `id_firecracker.pub` into the VM's `/root/.ssh/authorized_keys` if the file exists.

3. `agent_start.py` will prefer SSH key authentication when `id_firecracker` is present, falling back to `sshpass` only if needed.

## Manual Steps (Advanced)

If you prefer to run steps manually:

1. **Build Rootfs**: `sudo ./create_rootfs.sh`
2. **Launch VM**: `sudo ./launch.sh`
3. **Connect**: `ssh root@172.16.0.2` (password: root)

## Customization

- **Packages**: Edit `create_rootfs.sh` to add more packages to the `docker exec ... apt-get install` command.
- **Network**: Edit `launch.sh` to change IP addresses or network interfaces, or use the `FC_VM_IP` environment variable.
- **Kernel**: The `create_rootfs.sh` script extracts the `linux-image-kvm` kernel and initrd from the Ubuntu container, falling back to `linux-image-generic` if needed. This ensures compatibility with the Ubuntu userland and Firecracker.

## Troubleshooting

- **Permissions**: Ensure you run `create_rootfs.sh` and `launch.sh` with `sudo`.
- **KVM**: If Firecracker fails with "KVM not found", ensure your user has access to `/dev/kvm` or virtualization is enabled in BIOS.
- **Networking**: If the VM cannot access the internet, check the `iptables` rules in `launch.sh` and ensure your host's default interface is correctly detected.
- **Sync Safety**: The `sync` (pull) action intentionally does **not** use `--delete` to prevent accidental deletion of host files. The `start` (push) action uses `--delete` to keep the VM in sync with the host.
- **Cleanup**: `launch.sh` uses `trap` to clean up network resources (TAP device, iptables rules) on exit or interrupt.
