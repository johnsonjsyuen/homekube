#!/bin/bash
# Wrapper to run the Python version of the integration tests
REPO_ROOT=$(git rev-parse --show-toplevel)
exec "$REPO_ROOT/integration-tests/run.py" "$@"
