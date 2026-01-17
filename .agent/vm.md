# LLM Coding Agent: Firecracker VM Workflow

You are an AI coding agent that performs all code execution, testing, and development work inside an isolated Firecracker MicroVM. This ensures a safe, reproducible environment while keeping the user's local machine clean. After each work session, you sync changes back to the local filesystem.

## Environment Overview

- **VM IP**: `172.16.0.2`
- **VM User**: `root`
- **VM Password**: `root`
- **Workspace inside VM**: `/root/workspace`
- **Local workspace**: The parent directory of `firecracker-vm/`

## Workflow

### 1. Starting a Work Session

Before doing any work, ensure the VM is running and code is synced:

```bash
# From the repository root
python3 firecracker-vm/agent_start.py start
```

This command will:
- Build the VM image if it doesn't exist
- Boot the Firecracker VM
- Push the current repository code into `/root/workspace` inside the VM
- Wait for SSH to become available

### 2. Connecting to the VM

Once the VM is ready, connect via SSH:

```bash
sshpass -p root ssh -o StrictHostKeyChecking=no root@172.16.0.2
```

Or run commands remotely:

```bash
sshpass -p root ssh -o StrictHostKeyChecking=no root@172.16.0.2 "cd /root/workspace && <your command>"
```

### 3. Performing Work

Inside the VM at `/root/workspace`:
- Run tests
- Execute code
- Install dependencies
- Build projects
- Debug issues

All changes made to files in `/root/workspace` will be synced back to the host.

### 4. Syncing Changes Back to Local

After completing work (or periodically during long sessions), sync changes back:

```bash
# From the host machine
python3 firecracker-vm/agent_start.py sync
```

This pulls all changes from the VM's `/root/workspace` back to the local repository.

### 5. Ending a Session

When finished with all work:

```bash
python3 firecracker-vm/agent_start.py stop
```

This will:
- Pull final changes from the VM
- Shut down the Firecracker VM

---

## Agent Operational Rules

### Before Any Code Execution

1. **Check if VM is running**: Try to connect via SSH first
2. **If VM not running**: Run `python3 firecracker-vm/agent_start.py start`
3. **If VM is running**: Run `python3 firecracker-vm/agent_start.py sync` to push latest local changes

### During Work

1. **All code execution happens inside the VM** - never run untrusted code on the host
2. **All file modifications happen inside the VM** at `/root/workspace`
3. **Periodically sync** if making many changes: `python3 firecracker-vm/agent_start.py sync`

### After Each Work Block

1. **Always sync before reporting results**: `python3 firecracker-vm/agent_start.py sync`
2. **Verify sync completed successfully** before confirming changes to user

### On Session End or Pause

1. **Sync changes**: `python3 firecracker-vm/agent_start.py sync`
2. **Optionally stop VM** if work is complete: `python3 firecracker-vm/agent_start.py stop`

---

## Command Reference

| Action | Command |
|--------|---------|
| Start VM & push code | `python3 firecracker-vm/agent_start.py start` |
| Sync (pull from VM) | `python3 firecracker-vm/agent_start.py sync` |
| Stop VM & sync | `python3 firecracker-vm/agent_start.py stop` |
| SSH into VM | `sshpass -p root ssh root@172.16.0.2` |
| Run command in VM | `sshpass -p root ssh root@172.16.0.2 "command"` |

---

## Example Agent Session

```
# 1. User asks: "Run the tests and fix any failures"

# Agent starts VM session
$ python3 firecracker-vm/agent_start.py start
Building VM rootfs and kernel...
Launching Firecracker VM...
VM is ready!
Pushing repository to VM...
Sync completed successfully.

# Agent runs tests inside VM
$ sshpass -p root ssh root@172.16.0.2 "cd /root/workspace && pytest"
... test output ...
FAILED tests/test_foo.py::test_bar

# Agent edits code inside VM to fix the test
$ sshpass -p root ssh root@172.16.0.2 "cd /root/workspace && sed -i 's/old/new/' src/foo.py"

# Agent re-runs tests
$ sshpass -p root ssh root@172.16.0.2 "cd /root/workspace && pytest"
... all tests pass ...

# Agent syncs changes back to local
$ python3 firecracker-vm/agent_start.py sync
Sync completed successfully.

# 2. Agent reports success to user - changes are now in local filesystem
```

---

## Important Notes

- The VM provides an isolated Ubuntu 22.04 environment
- Changes to `.git` directory are excluded from sync
- Large binary artifacts in `firecracker-vm/` are excluded from sync
- The VM has internet access for installing dependencies
- Always sync before presenting results to ensure local files reflect VM state
