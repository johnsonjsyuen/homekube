import argparse
import subprocess
import sys
import os

# Configuration
VM_IP = "172.16.0.2"
VM_USER = "root"
VM_PASS = "root"
REMOTE_PATH = "/root/workspace"
# Host path defaults to the parent directory of this script (assuming this script is in firecracker_vm/)
HOST_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

def check_dependencies():
    if subprocess.run(["which", "sshpass"], capture_output=True).returncode != 0:
        print("Error: 'sshpass' is required.")
        print("Install via: sudo apt install sshpass")
        sys.exit(1)
    if subprocess.run(["which", "rsync"], capture_output=True).returncode != 0:
        print("Error: 'rsync' is required.")
        print("Install via: sudo apt install rsync")
        sys.exit(1)

def run_rsync(source, dest):
    """
    Runs rsync using sshpass for authentication.
    """
    cmd = [
        "sshpass", "-p", VM_PASS,
        "rsync", "-avz", "--delete",
        "-e", "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null",
        source, dest
    ]

    # Exclude the firecracker_vm directory itself and .git to avoid recursion or huge transfers
    # But usually we want .git if the agent needs to commit?
    # User said "copy the repository contents".
    # If we sync back, we don't want to overwrite the local .git if the VM has a weird state,
    # but normally we want to keep them in sync.
    # However, syncing .git can be tricky if permissions differ.
    # Let's exclude .git for safety unless requested, but usually "working on repo" implies code.
    # We will exclude the firecracker_vm artifacts (images) to avoid copying big files back and forth.

    excludes = [
        "--exclude=.git",
        "--exclude=firecracker_vm/ubuntu-rootfs.ext4",
        "--exclude=firecracker_vm/ubuntu.tar",
        "--exclude=firecracker_vm/ubuntu-vmlinux.bin",
        "--exclude=firecracker_vm/firecracker"
    ]

    # Insert excludes before source
    cmd[6:6] = excludes

    print(f"Syncing {source} -> {dest} ...")
    result = subprocess.run(cmd)
    if result.returncode == 0:
        print("Sync completed successfully.")
    else:
        print("Sync failed.")
        sys.exit(result.returncode)

def main():
    parser = argparse.ArgumentParser(description="Sync repository to/from Firecracker VM")
    parser.add_argument("action", choices=["push", "pull"], help="Action to perform")
    args = parser.parse_args()

    check_dependencies()

    # Ensure remote directory exists before pushing
    if args.action == "push":
        # Create remote dir
        setup_cmd = [
            "sshpass", "-p", VM_PASS,
            "ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
            f"{VM_USER}@{VM_IP}",
            f"mkdir -p {REMOTE_PATH}"
        ]
        subprocess.run(setup_cmd, check=True, capture_output=True)

        # Rsync host to remote
        # Note: trailing slash on HOST_PATH ensures contents are copied INTO REMOTE_PATH
        run_rsync(f"{HOST_PATH}/", f"{VM_USER}@{VM_IP}:{REMOTE_PATH}/")

    elif args.action == "pull":
        # Rsync remote to host
        run_rsync(f"{VM_USER}@{VM_IP}:{REMOTE_PATH}/", f"{HOST_PATH}/")

if __name__ == "__main__":
    main()
