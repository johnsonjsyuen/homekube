#!/bin/bash
# Wrapper to run the Python version of the integration tests
REPO_ROOT=$(git rev-parse --show-toplevel)

# Add Rancher Desktop bin to PATH if it exists
if [ -d "$HOME/.rd/bin" ]; then
    export PATH="$HOME/.rd/bin:$PATH"
fi
exec "$REPO_ROOT/integration-tests/run.py" "$@"
