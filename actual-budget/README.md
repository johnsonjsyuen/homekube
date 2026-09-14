# Actual Budget

Implementation specification and operations reference for the official [Actual
server](https://actualbudget.org/docs/install/docker/). This deployment provides
the web app and budget synchronization on the local cluster without a custom
build, external database, or bank integration.

## Deployment design

- Release `26.9.0`, one replica, `Recreate` updates to avoid concurrent SQLite writers.
- A 5 GiB `local-path` RWO PVC holds all of `/data`, including authentication and budgets.
- Run as UID/GID 1001 with volume group 1001 and no Kubernetes API token.
- Request 100m CPU and 256 MiB memory; limit 1 CPU and 1 GiB memory.
- ClusterIP `actual-budget.default:80` forwards to port 5006.
- Password authentication only. Initialize privately before adding the public route.
- HTTPS hostname `actual.johnsonyuen.com` uses the existing dashboard-managed
  Cloudflare Tunnel, origin `http://actual-budget.default`. No Kubernetes Ingress.

## Deploy and access

```sh
kubectl apply -k actual-budget/k8s
kubectl rollout status deployment/actual-budget --timeout=180s
kubectl port-forward service/actual-budget 5006:80
```

Open `http://localhost:5006` to set the initial server password before publishing
the Cloudflare route. Localhost is a secure browser context; plain HTTP on a LAN
IP is not suitable for Actual's browser storage requirements. For this initial
deployment, an operator-generated password is stored in the out-of-band Kubernetes
Secret `actual-budget-initial-password` (key `password`); retrieve it locally:

```sh
kubectl get secret actual-budget-initial-password -o jsonpath='{.data.password}' | base64 -d
```

The Secret is a handoff copy, not application configuration. After changing the
password in Actual, remove the stale Secret. Never commit credentials.

In Cloudflare's existing tunnel, add public hostname `actual.johnsonyuen.com`
with HTTP origin `http://actual-budget.default`. This is an external prerequisite;
`kubectl apply` cannot create a dashboard-managed route. Confirm the hostname's
DNS record is created by Cloudflare and bypass caching for this hostname.

## Verification

Static checks: Kustomize renders; server dry-run accepts manifests; selectors
match; Service targets named port `http`; `/data` references the persistent PVC.

Integration acceptance:

1. Deployment becomes available and PVC becomes Bound; `/` returns HTTP 200.
2. `/account/needs-bootstrap` reports `bootstrapped: true`; valid password login
   succeeds and a wrong password is rejected. Do not log session tokens.
3. Restart the deployment and confirm authentication persists; HTTPS returns the
   app with `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: require-corp`.

## Recovery and data safety

| Failure | Detection | Action |
| --- | --- | --- |
| Image unavailable | Pod ImagePullBackOff | Check registry access and pinned release |
| Volume unavailable | Pending pod/PVC | Inspect local-path provisioner and node disk |
| Startup or runtime failure | Probe failures, pod logs | Inspect logs and configuration before changing image |
| Public route unavailable | HTTPS fails while port-forward works | Check tunnel hostname, DNS and origin |
| Authentication failure | Login rejected | Verify password; use upstream recovery instructions |

Before upgrades, stop the deployment and back up the entire PVC (`server-files`,
`user-files`, and configuration); restart it after the copy finishes. Local-path
storage does not survive node/disk loss, and deleting the PVC deletes its data.
For restore, stop Actual, restore the complete backup with UID/GID 1001, then
start the version corresponding to the backup. Do not assume an older image can
read a database migrated by a newer release. Scheduled backups are not configured.

## Anti-patterns

- Do not use multiple replicas against the same SQLite data.
- Do not use `emptyDir` for `/data`.
- Do not expose an uninitialized server publicly.
- Do not commit passwords, session tokens, or Cloudflare tokens.
- Do not use floating image tags or downgrade migrated data without a backup.
- Do not delete the PVC or apply namespace-wide cleanup to uninstall the app.

## References

- [Server configuration](https://actualbudget.org/docs/config/)
- [HTTPS requirements](https://actualbudget.org/docs/config/https/)
- [Repository tunnel convention](../CLAUDE.md#service-patterns)
- [Manifests](k8s/kustomization.yaml)

Planning review: all 13 Stream Coding clarity checks pass; this document is the
single implementation reference. Existing upstream software needs manifest and
runtime checks rather than new application unit tests.
