# Grafana Dashboards via Crossplane

Manages Grafana dashboards as Kubernetes resources using the [Crossplane Grafana provider](https://marketplace.upbound.io/providers/grafana/provider-grafana/v2.5.0).

## Prerequisites

- k3s cluster running
- [kube-prometheus-stack](../install.sh) deployed in `monitoring` namespace
- `helm` and `kubectl` CLI tools
- `gh` CLI (optional, for PRs)

## Setup

### 1. Get the Grafana admin password

```bash
kubectl -n monitoring get secret kube-prometheus-stack-grafana \
  -o jsonpath='{.data.admin-password}' | base64 -d
```

### 2. Create the credentials secret

This stores Grafana URL and admin credentials in the `crossplane-system` namespace. The secret is not checked into git.

```bash
./create-secret.sh <grafana-admin-password>
```

### 3. Run the install script

```bash
./install.sh
```

This will:
1. Add the Crossplane Helm repo and install Crossplane in `crossplane-system`
2. Install `provider-grafana` (v2.5.0) and wait for it to become healthy
3. Verify the credentials secret exists, then apply the ProviderConfig
4. Create a "Homekube" folder in Grafana
5. Apply all dashboards and wait for them to become ready

### 4. Verify

```bash
kubectl get providers
kubectl get folder.oss.grafana.crossplane.io
kubectl get dashboard.oss.grafana.crossplane.io
```

All resources should show `SYNCED=True` and `READY=True`. Dashboards will appear in Grafana under the **Homekube** folder.

## Dashboards

| Dashboard | Panels | Key Metrics |
|-----------|--------|-------------|
| **Overview** | 8 | Service health (up/down), 24h activity counts |
| **Text-to-Speech** | 5 | Active jobs, jobs by status, generation duration, HTTP rate/latency |
| **Speech-to-Text** | 6 | Active sessions, transcription rate/duration, audio segments, HTTP rate/latency |
| **WhatsApp** | 6 | Active sessions, session connects, messages sent/received, HTTP rate/latency |
| **News Worker** | 8 | Workflow runs, success rate, duration, articles fetched, messages sent, HTTP rate/latency |

## Adding a new dashboard

1. Create a YAML file in `dashboards/`:

```yaml
apiVersion: oss.grafana.crossplane.io/v1alpha1
kind: Dashboard
metadata:
  name: my-dashboard
spec:
  forProvider:
    folderRef:
      name: homekube
    configJson: |
      {
        "title": "My Dashboard",
        "uid": "homekube-my-dashboard",
        "tags": ["homekube"],
        "panels": [ ... ]
      }
```

2. Apply it:

```bash
kubectl apply -f dashboards/my-dashboard.yaml
```

## Updating a dashboard

Edit the YAML and re-apply. Crossplane will reconcile the change in Grafana automatically.

```bash
kubectl apply -f dashboards/overview.yaml
```

## Rotating the Grafana password

Re-run the secret script — it's idempotent:

```bash
./create-secret.sh <new-password>
```

Then restart the provider pod to pick up the new credentials:

```bash
kubectl -n crossplane-system rollout restart deployment \
  $(kubectl -n crossplane-system get deploy -l pkg.crossplane.io/package=provider-grafana -o name)
```

## File structure

```
monitoring/crossplane/
  install.sh              # Full setup script
  create-secret.sh        # Creates credentials secret (not in git)
  provider.yaml           # Crossplane Provider resource
  provider-config.yaml    # ProviderConfig (references secret)
  folder.yaml             # "Homekube" Grafana folder
  dashboards/
    overview.yaml         # Service health + 24h stats
    text-to-speech.yaml   # TTS job and HTTP metrics
    speech-to-text.yaml   # STT session and HTTP metrics
    whatsapp.yaml         # WhatsApp message and HTTP metrics
    news-worker.yaml      # Workflow and HTTP metrics
```
