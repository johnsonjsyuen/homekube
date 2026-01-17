import subprocess
import time
import sys

VM_IP = "172.16.0.2"
USER = "root"
PASSWORD = "root" # Note: sshpass is needed for password auth if not using keys

# Check if sshpass is installed
if subprocess.run(["which", "sshpass"], capture_output=True).returncode != 0:
    print("Error: 'sshpass' is required for this script to use password authentication.")
    print("Install it via: sudo apt install sshpass")
    print("Or configure SSH keys in the rootfs.")
    sys.exit(1)

def run_remote_command(cmd):
    """
    Runs a command on the VM via SSH using sshpass.
    """
    ssh_cmd = [
        "sshpass", "-p", PASSWORD,
        "ssh",
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-o", "ConnectTimeout=5",
        f"{USER}@{VM_IP}",
        cmd
    ]
    return subprocess.run(ssh_cmd, capture_output=True, text=True)

print(f"Connecting to AI Agent Environment at {VM_IP}...")

# Wait for connection
connected = False
for i in range(30):
    res = run_remote_command("echo Ready")
    if res.returncode == 0:
        print("VM is ready!")
        connected = True
        break
    print(f"Waiting for VM... ({i+1}/30)")
    time.sleep(2)

if not connected:
    print("Failed to connect to VM.")
    sys.exit(1)

# Example: Run a Python script inside the VM
print("\nRunning a Python calculation inside the VM:")
py_script = "python3 -c 'import platform; print(f\"Running on {platform.node()} {platform.machine()}\")'"
res = run_remote_command(py_script)
if res.returncode == 0:
    print("Result:\n" + res.stdout)
else:
    print("Error:\n" + res.stderr)

# Example: Check disk space
print("\nChecking disk space:")
res = run_remote_command("df -h /")
print(res.stdout)
