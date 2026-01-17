import argparse
import subprocess
import sys
import os
import time
import socket

# Configuration
VM_IP = "172.16.0.2"
VM_USER = "root"
VM_PASS = "root"
REMOTE_PATH = "/root/workspace"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# Host path defaults to the parent directory of this script
HOST_PATH = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))

ROOTFS_IMG = os.path.join(SCRIPT_DIR, "ubuntu-rootfs.ext4")
KERNEL_BIN = os.path.join(SCRIPT_DIR, "ubuntu-vmlinux.bin")

def check_dependencies():
    deps = ["sshpass", "rsync", "docker"]
    for dep in deps:
        if subprocess.run(["which", dep], capture_output=True).returncode != 0:
            print(f"Error: '{dep}' is required.")
            sys.exit(1)

def run_command(cmd, cwd=None, background=False):
    """Run a shell command."""
    if background:
        return subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        return subprocess.run(cmd, cwd=cwd, check=True)

def is_vm_running():
    """Check if the API socket exists, implying VM is running."""
    # This is a loose check, but sufficient for this context.
    # Better to check if the process is running or port is open.
    # Let's check ssh port
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(1)
    result = sock.connect_ex((VM_IP, 22))
    sock.close()
    return result == 0

def build_vm():
    """Run the create_rootfs.sh script."""
    print("Building VM rootfs and kernel (this may take a while)...")
    run_command(["sudo", "./create_rootfs.sh"], cwd=SCRIPT_DIR)

def start_vm():
    """Run the launch.sh script."""
    print("Launching Firecracker VM...")
    # launch.sh runs in foreground, so we run it in background
    # We need sudo
    # We redirect output to a log file
    log_file = open(os.path.join(SCRIPT_DIR, "vm.log"), "w")
    subprocess.Popen(["sudo", "./launch.sh"], cwd=SCRIPT_DIR, stdout=log_file, stderr=log_file)

    print("Waiting for VM to boot...")
    # Wait for SSH to be available
    for i in range(30):
        if is_vm_running():
            print("VM is ready!")
            return
        time.sleep(2)
        print(f"Waiting... ({i+1}/30)")

    print("Error: VM failed to start or is unreachable.")
    print("Check firecracker_vm/vm.log for details.")
    sys.exit(1)

def stop_vm():
    """Stop the VM."""
    print("Stopping VM...")
    # We can use the API socket or just kill the process.
    # launch.sh creates a pid? No.
    # We'll use pkill on firecracker for simplicity in this dev script.
    subprocess.run(["sudo", "pkill", "-f", "firecracker"], check=False)
    # Also clean up tap if needed, but launch.sh does that on start.

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

    # Exclude artifacts and .git
    excludes = [
        "--exclude=.git",
        "--exclude=firecracker_vm/ubuntu-rootfs.ext4",
        "--exclude=firecracker_vm/ubuntu.tar",
        "--exclude=firecracker_vm/ubuntu-vmlinux.bin",
        "--exclude=firecracker_vm/ubuntu-initrd.img",
        "--exclude=firecracker_vm/firecracker",
        "--exclude=firecracker_vm/vm.log"
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

def sync_push():
    # Create remote dir first
    setup_cmd = [
        "sshpass", "-p", VM_PASS,
        "ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
        f"{VM_USER}@{VM_IP}",
        f"mkdir -p {REMOTE_PATH}"
    ]
    subprocess.run(setup_cmd, check=True, capture_output=True)

    run_rsync(f"{HOST_PATH}/", f"{VM_USER}@{VM_IP}:{REMOTE_PATH}/")

def sync_pull():
    run_rsync(f"{VM_USER}@{VM_IP}:{REMOTE_PATH}/", f"{HOST_PATH}/")

def main():
    parser = argparse.ArgumentParser(description="Manage Firecracker VM Agent Session")
    parser.add_argument("action", choices=["start", "sync", "stop"], default="start", nargs="?",
                      help="start: Build/Boot VM and push code. sync: Pull code from VM. stop: Pull code and stop VM.")
    args = parser.parse_args()

    check_dependencies()

    if args.action == "start":
        # Check if artifacts exist
        if not os.path.exists(ROOTFS_IMG) or not os.path.exists(KERNEL_BIN):
            print("VM artifacts missing.")
            build_vm()

        if not is_vm_running():
            start_vm()
        else:
            print("VM is already running.")

        print("Pushing repository to VM...")
        sync_push()
        print("\nSession Ready!")
        print(f"SSH: sshpass -p {VM_PASS} ssh {VM_USER}@{VM_IP}")
        print("Run 'python3 firecracker_vm/agent_start.py sync' to pull changes back.")
        print("Run 'python3 firecracker_vm/agent_start.py stop' to pull changes and stop VM.")

    elif args.action == "sync":
        if not is_vm_running():
            print("Error: VM is not running.")
            sys.exit(1)
        print("Pulling changes from VM...")
        sync_pull()

    elif args.action == "stop":
        if is_vm_running():
            print("Pulling final changes from VM...")
            sync_pull()
            stop_vm()
        else:
            print("VM is not running.")

if __name__ == "__main__":
    main()
