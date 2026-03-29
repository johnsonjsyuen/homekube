# Temporal Workflow Engine

Umbrella Helm chart that deploys [Temporal](https://temporal.io/) (v1.29.1) with a [CloudNative PG](https://cloudnative-pg.io/) PostgreSQL database cluster.

## Prerequisites

- Kubernetes cluster (tested on k3s)
- [CNPG operator](https://cloudnative-pg.io/documentation/current/installation_upgrade/) installed (`cnpg-system` namespace)
- [Helm 3.x](https://helm.sh/docs/intro/install/)

## Quick Start

```bash
# Add the Temporal helm repo (needed for dependency resolution)
helm repo add temporal https://go.temporal.io/helm-charts

# Build dependencies
cd temporal/chart
helm dependency build

# Install
helm install temporal . --namespace temporal --create-namespace

# Verify
helm test temporal -n temporal
```

## What Gets Deployed

A single `helm install` provisions everything:

| Component | Description |
|-----------|-------------|
| **CNPG Cluster** | PostgreSQL instance with `temporal` and `temporal_visibility` databases |
| **Schema Job** | One-shot job that runs Temporal schema migrations (retries until DB is ready) |
| **Frontend** | gRPC server (port 7233, NodePort 30233) — client/worker entry point |
| **History** | Manages workflow execution history |
| **Matching** | Routes tasks to workers via task queues |
| **Worker** | Internal Temporal system worker |
| **Web UI** | Browser UI (port 8080) for inspecting workflows |
| **Admin Tools** | Pod with `tctl` and `temporal` CLI |

### Startup Ordering

All resources are submitted simultaneously. The CNPG cluster takes ~30-60 seconds to become ready. During this window, the schema job and server pods fail and retry automatically (`backoffLimit: 100`). Once PostgreSQL is available, schema migrations run and the server pods stabilise. No manual intervention needed.

## Configuration

### Default Values

```yaml
cnpg:
  name: temporal-db
  instances: 1
  storage:
    size: 2Gi

temporal:
  server:
    config:
      numHistoryShards: 128   # Immutable after first install
```

### External Access

The frontend gRPC service is exposed as a NodePort on port **30233**. LAN workers connect using:

```
TEMPORAL_ADDRESS=<node-ip>:30233
```

### Common Overrides

```bash
# HA database (2 instances)
helm install temporal . -n temporal --set cnpg.instances=2

# Increase storage
helm install temporal . -n temporal --set cnpg.storage.size=5Gi
```

### CNPG Name Coupling

The CNPG cluster name (`cnpg.name`) determines the service (`<name>-rw`) and secret (`<name>-app`) names. These are referenced in the Temporal persistence config. If you change `cnpg.name` from the default `temporal-db`, you must also update:

- `temporal.server.config.persistence.default.sql.host`
- `temporal.server.config.persistence.default.sql.existingSecret`
- `temporal.server.config.persistence.visibility.sql.host`
- `temporal.server.config.persistence.visibility.sql.existingSecret`

## Testing

```bash
helm test temporal -n temporal
```

### How the Test Works

The test uses Helm's built-in test framework via `helm.sh/hook: test` annotations. Test resources are **not deployed during `helm install`** — they only run on-demand when you execute `helm test`.

**Flow:**

1. Helm creates a ConfigMap containing the Python test script (hook-weight `-5`, created first)
2. Helm creates a Job that starts a `python:3.12-slim` pod
3. The pod installs the `temporalio` SDK and runs the test script
4. The script connects to `temporal-frontend:7233`, spins up an in-process Worker, executes a `GreetingWorkflow`, and asserts the result is `"Hello, World!"`
5. Helm watches the Job — exit code 0 means the test passed

**Cleanup:**

- `hook-delete-policy: before-hook-creation` deletes old test resources when you run `helm test` again
- `ttlSecondsAfterFinished: 300` auto-cleans the Job pod after 5 minutes

### Manual Verification

```bash
# Check cluster health
kubectl exec -n temporal deploy/temporal-admintools -- temporal operator cluster health

# Create a namespace
kubectl exec -n temporal deploy/temporal-admintools -- temporal operator namespace create default

# List workflows
kubectl exec -n temporal deploy/temporal-admintools -- temporal workflow list -n default
```

## Architecture

```
┌─────────────────────────────────────────────┐
│  Client / Worker                            │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
         temporal-frontend:7233 (NodePort 30233)
                   │
      ┌────────────┼────────────┐
      ▼            ▼            ▼
   history     matching      worker
      │            │            │
      └────────────┴────────────┘
                   │
                   ▼
         temporal-db-rw:5432
    ┌──────────────────────────────┐
    │  temporal          (history) │
    │  temporal_visibility (search)│
    └──────────────────────────────┘
```

## Chart Structure

```
temporal/chart/
├── Chart.yaml                        # Depends on temporal/temporal 0.73.1
├── Chart.lock                        # Pinned dependency version
├── values.yaml                       # CNPG config + Temporal subchart values
├── charts/                           # (gitignored) downloaded dependency
└── templates/
    ├── _helpers.tpl
    ├── cnpg-cluster.yaml             # CNPG PostgreSQL cluster
    └── tests/
        ├── test-configmap.yaml       # Workflow test script
        └── test-job.yaml             # Test runner job
```

## Uninstall

```bash
helm uninstall temporal -n temporal
kubectl delete ns temporal
```
