import argparse
import subprocess
import sys
import os
import time
import socket

# Configuration (overridable via environment variables)
VM_IP = os.environ.get("FC_VM_IP", "172.16.0.2")
VM_USER = os.environ.get("FC_VM_USER", "root")
VM_PASS = os.environ.get("FC_VM_PASS", "root")
REMOTE_PATH = os.environ.get("FC_REMOTE_PATH", "/root/workspace")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# Host path defaults to the parent directory of this script
HOST_PATH = os.path.abspath(os.environ.get("FC_HOST_PATH", os.path.join(SCRIPT_DIR, "..")))

ROOTFS_IMG = os.path.join(SCRIPT_DIR, "ubuntu-rootfs.ext4")
KERNEL_BIN = os.path.join(SCRIPT_DIR, "ubuntu-vmlinux.bin")
PID_FILE = os.path.join(SCRIPT_DIR, ".firecracker.pid")
SSH_KEY = os.path.join(SCRIPT_DIR, "id_firecracker")

# Common SSH options to avoid interactive prompts
SSH_OPTS = [
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "ConnectTimeout=5",
]


def _ssh_base_cmd():
    """Return the base SSH command list, preferring key auth when available."""
    if os.path.exists(SSH_KEY):
        return ["ssh", *SSH_OPTS, "-i", SSH_KEY]
    return ["sshpass", "-p", VM_PASS, "ssh", *SSH_OPTS]


def _rsync_ssh_shell():
    """Return the SSH shell string for rsync -e, preferring key auth."""
    if os.path.exists(SSH_KEY):
        return f"ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i {SSH_KEY}"
    return "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"


def check_dependencies():
    deps = ["sshpass", "rsync", "docker"]
    missing = []
    for dep in deps:
        if subprocess.run(["which", dep], capture_output=True).returncode != 0:
            missing.append(dep)
    if missing:
        print(f"Error: Missing required dependencies: {', '.join(missing)}")
        sys.exit(1)


def run_command(cmd, cwd=None, background=False):
    """Run a shell command."""
    if background:
        return subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        return subprocess.run(cmd, cwd=cwd, check=True)


def is_port_open(host, port, timeout=1):
    """Check if a TCP port is open."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        result = sock.connect_ex((host, port))
        return result == 0
    finally:
        sock.close()


def is_vm_running():
    """Check if the VM is reachable and sshd is actually accepting commands."""
    if not is_port_open(VM_IP, 22):
        return False

    # Verify sshd is ready by running a simple command
    test_cmd = _ssh_base_cmd() + [f"{VM_USER}@{VM_IP}", "echo ready"]
    result = subprocess.run(test_cmd, capture_output=True)
    return result.returncode == 0


def get_firecracker_pid():
    """Read the Firecracker PID from the pid file if it exists."""
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, "r") as f:
                return int(f.read().strip())
        except (ValueError, OSError):
            return None
    return None


def save_firecracker_pid(pid):
    """Save the Firecracker PID to the pid file."""
    with open(PID_FILE, "w") as f:
        f.write(str(pid))


def remove_pid_file():
    """Remove the pid file."""
    if os.path.exists(PID_FILE):
        os.remove(PID_FILE)


def build_vm():
    """Run the create_rootfs.sh script."""
    print("Building VM rootfs and kernel (this may take a while)...")
    run_command(["sudo", "./create_rootfs.sh"], cwd=SCRIPT_DIR)


def start_vm():
    """Run the launch.sh script."""
    print("Launching Firecracker VM...")
    log_path = os.path.join(SCRIPT_DIR, "vm.log")
    with open(log_path, "w") as log_file:
        proc = subprocess.Popen(
            ["sudo", "./launch.sh"],
            cwd=SCRIPT_DIR,
            stdout=log_file,
            stderr=log_file,
        )
    save_firecracker_pid(proc.pid)

    print("Waiting for VM to boot...")
    for i in range(30):
        if is_vm_running():
            print("VM is ready!")
            return
        time.sleep(2)
        print(f"Waiting... ({i+1}/30)")

    print("Error: VM failed to start or is unreachable.")
    print(f"Check {log_path} for details.")
    sys.exit(1)


def stop_vm():
    """Stop the VM using the tracked PID."""
    print("Stopping VM...")
    pid = get_firecracker_pid()
    if pid:
        try:
            os.kill(pid, 15)  # SIGTERM
            time.sleep(1)
            try:
                os.kill(pid, 0)  # Check if still alive
                os.kill(pid, 9)  # SIGKILL
            except ProcessLookupError:
                pass
        except ProcessLookupError:
            print("VM process already exited.")
    else:
        # Fallback: try to find and kill firecracker processes owned by root
        print("No PID file found, attempting to stop any running firecracker...")
        subprocess.run(["sudo", "pkill", "-x", "firecracker"], check=False)
    remove_pid_file()


def build_rsync_cmd(source, dest, delete=False):
    """Build an rsync command with SSH and excludes."""
    cmd = [
        "rsync", "-avz",
        "-e", _rsync_ssh_shell(),
    ]
    if delete:
        cmd.append("--delete")

    excludes = [
        "--exclude=.git",
        "--exclude=firecracker-vm/ubuntu-rootfs.ext4",
        "--exclude=firecracker-vm/ubuntu.tar",
        "--exclude=firecracker-vm/ubuntu-vmlinux.bin",
        "--exclude=firecracker-vm/ubuntu-initrd.img",
        "--exclude=firecracker-vm/firecracker",
        "--exclude=firecracker-vm/vm.log",
        "--exclude=firecracker-vm/.firecracker.pid",
        "--exclude=firecracker-vm/vm_config.json",
    ]
    cmd.extend(excludes)
    cmd.extend([source, dest])
    return cmd


def run_rsync(source, dest, delete=False):
    """Run rsync using sshpass for authentication."""
    cmd = build_rsync_cmd(source, dest, delete=delete)
    print(f"Syncing {source} -> {dest} ...")
    result = subprocess.run(cmd)
    if result.returncode == 0:
        print("Sync completed successfully.")
    else:
        print("Sync failed.")
        sys.exit(result.returncode)


def sync_push():
    """Push host code to the VM (uses --delete to keep VM in sync with host)."""
    setup_cmd = _ssh_base_cmd() + [f"{VM_USER}@{VM_IP}", f"mkdir -p {REMOTE_PATH}"]
    subprocess.run(setup_cmd, check=True, capture_output=True)
    run_rsync(f"{HOST_PATH}/", f"{VM_USER}@{VM_IP}:{REMOTE_PATH}/", delete=True)


def sync_pull():
    """Pull code from the VM to the host (does NOT use --delete to avoid host data loss)."""
    run_rsync(f"{VM_USER}@{VM_IP}:{REMOTE_PATH}/", f"{HOST_PATH}/", delete=False)


def run_remote_command(cmd):
    """Run a command on the VM via SSH."""
    ssh_cmd = _ssh_base_cmd() + [f"{VM_USER}@{VM_IP}", cmd]
    return subprocess.run(ssh_cmd, capture_output=True, text=True)


def status_vm():
    """Check and print the VM status."""
    pid = get_firecracker_pid()
    port_open = is_port_open(VM_IP, 22)
    ssh_ready = is_vm_running()

    print(f"PID file:     {'exists' if pid else 'missing'} (pid={pid})")
    print(f"SSH port 22:  {'open' if port_open else 'closed'}")
    print(f"SSH ready:    {'yes' if ssh_ready else 'no'}")

    if ssh_ready:
        res = run_remote_command("uptime")
        if res.returncode == 0:
            print(f"VM uptime:    {res.stdout.strip()}")
        else:
            print("VM uptime:    unavailable")
    else:
        print("VM uptime:    unavailable")

    # Warn if using password auth
    if not os.path.exists(SSH_KEY):
        print("\nWarning: Using password authentication. Consider generating an SSH key:")
        print(f"  ssh-keygen -t ed25519 -f {SSH_KEY} -N \"\"")
        print("Then rebuild the rootfs to inject the public key into the VM.")


def main():
    parser = argparse.ArgumentParser(description="Manage Firecracker VM Agent Session")
    parser.add_argument(
        "action",
        choices=["start", "sync", "stop", "status"],
        default="start",
        nargs="?",
        help=(
            "start:  Build/Boot VM and push code.\n"
            "sync:   Pull code from VM.\n"
            "stop:   Pull code and stop VM.\n"
            "status: Check VM health."
        ),
    )
    args = parser.parse_args()

    check_dependencies()

    if args.action == "start":
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
        print("Run 'python3 firecracker-vm/agent_start.py sync' to pull changes back.")
        print("Run 'python3 firecracker-vm/agent_start.py stop' to pull changes and stop VM.")

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

    elif args.action == "status":
        status_vm()


if __name__ == "__main__":
    main()
