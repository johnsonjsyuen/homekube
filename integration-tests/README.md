# Integration Tests

This directory contains scripts to run integration tests for the project using a Kind Kubernetes cluster.

## Prerequisites

Ensure you have the following tools installed and available in your PATH:

- [Docker](https://docs.docker.com/get-docker/)
- [Kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)

## Running the Tests

To run the integration tests, execute the `run.sh` script:

```bash
./run.sh
```

This script will:
1. Create a Kind cluster named `integration-test` (if it doesn't already exist).
2. Install the CloudNativePG operator.
3. Build and load Docker images for `homepage` and `speedtest`.
4. Deploy the applications to the cluster.
5. Verify that the deployments rollout successfully.
6. Run basic connectivity checks.

## Cleanup

To clean up the environment, you can delete the Kind cluster:

```bash
kind delete cluster --name integration-test
```
