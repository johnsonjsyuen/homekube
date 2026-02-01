#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
NC='\033[0m' # No Color
INFO="${GREEN}[INFO]${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (use sudo)"
  exit 1
fi

echo -e "${INFO} Starting Forgejo Runner installation..."

# 1. Install dependencies
echo -e "${INFO} Checking dependencies..."
if ! command -v docker &> /dev/null || ! command -v git &> /dev/null || ! command -v curl &> /dev/null; then
    echo -e "${INFO} Installing dependencies..."
    apt-get update
    apt-get install -y curl git docker.io
else
    echo -e "${INFO} Dependencies already installed."
fi

# Ensure Docker is running
systemctl enable --now docker

# 2. Download Forgejo Runner
RUNNER_VERSION="v6.0.1" # Update this to the desired version
ARCH="amd64" # Default to amd64 for now, can be detected dynamically if needed
BINARY_URL="https://code.forgejo.org/forgejo/runner/releases/download/${RUNNER_VERSION}/forgejo-runner-6.0.1-linux-${ARCH}"
INSTALL_PATH="/usr/local/bin/forgejo-runner"

echo -e "${INFO} Downloading Forgejo Runner ${RUNNER_VERSION} for ${ARCH}..."
if [ -f "${INSTALL_PATH}" ]; then
    echo -e "${INFO} Runner binary already exists at ${INSTALL_PATH}, skipping download."
else
    curl -L -o "${INSTALL_PATH}" "${BINARY_URL}"
fi
chmod +x "${INSTALL_PATH}"

# verify installation
"${INSTALL_PATH}" --version

# 3. User Prompts for Registration
echo -e "${INFO} Configuration & Registration"
read -p "Forgejo Instance URL (e.g., https://git.example.com): " INSTANCE_URL
read -p "Registration Token: " TOKEN
read -p "Runner Name (default: $(hostname)-runner): " RUNNER_NAME
RUNNER_NAME=${RUNNER_NAME:-$(hostname)-runner}
read -p "Runner Labels (default: ubuntu-latest:docker://node:20-bookworm,ubuntu-22.04:docker://node:20-bookworm): " LABELS
LABELS=${LABELS:-ubuntu-latest:docker://node:20-bookworm,ubuntu-22.04:docker://node:20-bookworm}

# 4. Create User and Directory
RUNNER_USER="forgejo-runner"
RUNNER_HOME="/home/${RUNNER_USER}"

if ! id "${RUNNER_USER}" &>/dev/null; then
    echo -e "${INFO} Creating user ${RUNNER_USER}..."
    useradd -m -s /bin/bash "${RUNNER_USER}"
fi

# Always ensure user is in docker group
usermod -aG docker "${RUNNER_USER}"

mkdir -p "${RUNNER_HOME}/.runner-data"
chown -R "${RUNNER_USER}:${RUNNER_USER}" "${RUNNER_HOME}"

# 5. Register the Runner
# We run the registration as the runner user to ensure permissions are correct in the home directory
if [ -f "${RUNNER_HOME}/.runner" ]; then
    echo -e "${INFO} Runner already registered, skipping registration."
else
    echo -e "${INFO} Registering runner..."
    cd "${RUNNER_HOME}"
    sudo -u "${RUNNER_USER}" "${INSTALL_PATH}" register --no-interactive \
      --instance "${INSTANCE_URL}" \
      --token "${TOKEN}" \
      --name "${RUNNER_NAME}" \
      --labels "${LABELS}"
fi

# 6. Generate Config
# Generate a default config if it doesn't exist
if [ ! -f "${RUNNER_HOME}/config.yml" ]; then
    echo -e "${INFO} Generating default config..."
    sudo -u "${RUNNER_USER}" bash -c "\"${INSTALL_PATH}\" generate-config > \"${RUNNER_HOME}/config.yml\""
fi

# ALWAYS ensure configuration allows mounting docker socket
# This ensures that even if the config existed, we fix it for Dagger
if [ -f "${RUNNER_HOME}/config.yml" ]; then
    echo -e "${INFO} Ensuring config allows Docker socket mounting..."
    
    # robustly replace valid_volumes line preserving indentation
    # We use python if available for cleaner yaml editing, but fallback to sed
    # Since we want to be minimal, we just force the line to what we want
    
    # 1. Update valid_volumes
    # This regex matches 'spaces + valid_volumes:' and replaces the whole line
    # We set it to a flow list with the docker socket
    sed -i 's/^\(\s*\)valid_volumes:.*/\1valid_volumes: ["\/var\/run\/docker.sock"]/' "${RUNNER_HOME}/config.yml"
    echo -e "${INFO} Updated valid_volumes."

    # 2. Update options
    # options must be a string, not a list!
    sed -i 's/^\(\s*\)options:.*$/\1options: "-v \/var\/run\/docker.sock:\/var\/run\/docker.sock"/' "${RUNNER_HOME}/config.yml"
    echo -e "${INFO} Updated options."
    
    # Ensure ownership is correct
    chown "${RUNNER_USER}:${RUNNER_USER}" "${RUNNER_HOME}/config.yml"
fi

# 7. Create Systemd Service
if [ -f "/etc/systemd/system/forgejo-runner.service" ]; then
    echo -e "${INFO} Systemd service already exists, skipping creation."
else
    echo -e "${INFO} Creating systemd service..."
    cat <<EOF > /etc/systemd/system/forgejo-runner.service
[Unit]
Description=Forgejo Runner
After=network.target docker.service
Requires=docker.service

[Service]
Restart=always
User=${RUNNER_USER}
WorkingDirectory=${RUNNER_HOME}
ExecStart=${INSTALL_PATH} daemon --config ${RUNNER_HOME}/config.yml
Environment=HOME=${RUNNER_HOME}

[Install]
WantedBy=multi-user.target
EOF
fi

# 8. Enable and Start Service
echo -e "${INFO} Enabling and starting service..."
systemctl daemon-reload
systemctl enable forgejo-runner
systemctl restart forgejo-runner

# 9. Verify Status
systemctl status forgejo-runner --no-pager

echo -e "${INFO} Installation and registration complete!"
echo "You can check logs with: journalctl -u forgejo-runner -f"
