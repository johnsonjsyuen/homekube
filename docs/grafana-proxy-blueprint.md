# Grafana Proxy Blueprint

## Problem

Grafana is deployed via kube-prometheus-stack in the `monitoring` namespace but has no external access and no authentication. We need to expose it securely at `grafana.johnsonyuen.com` with Keycloak-based login.

## Architecture

```
Browser → Cloudflare Tunnel → grafana-proxy (nginx, default ns) → Grafana (monitoring ns)
                                                                        ↕
                                                                Keycloak (OIDC login)
```

### Components

1. **Grafana** (existing, `monitoring` namespace) — has built-in OAuth2/OIDC support, handles Keycloak login natively
2. **grafana-proxy** (new, `default` namespace) — nginx reverse proxy that forwards traffic to Grafana across namespaces
3. **Keycloak** (existing, `keycloak` namespace) — identity provider, new `grafana` client added
4. **Cloudflare Tunnel** (existing) — routes `grafana.johnsonyuen.com` to the proxy

### Why a proxy?

Grafana runs in the `monitoring` namespace. The Cloudflare tunnel routes to services in the `default` namespace. The nginx proxy bridges this gap with a simple reverse proxy — no auth logic, no middleware.

### What we're NOT building

- **Custom auth middleware** — Grafana handles OAuth2 natively
- **oauth2-proxy sidecar** — unnecessary since Grafana has built-in OIDC support
- **Ingress controller** — Cloudflare Tunnel replaces traditional ingress

## Key Design Decisions

### Split URLs for Keycloak endpoints

- `auth_url` uses the external URL (`https://auth.johnsonyuen.com/...`) because the browser must redirect there
- `token_url` and `api_url` use internal cluster DNS (`http://keycloak.keycloak.svc.cluster.local/...`) for server-to-server calls, avoiding hairpin through Cloudflare

### Dedicated domain instead of sub-path

Previous Grafana config used `root_url: %(protocol)s://%(domain)s/grafana` with `serve_from_sub_path: true`. Moving to a dedicated `grafana.johnsonyuen.com` domain simplifies the proxy config and OAuth2 redirect URIs.

### Role mapping

Keycloak realm roles map to Grafana org roles via JMESPath:
- All authenticated users → Viewer
- Users with `grafana-admin` realm role → Admin

## Security

- TLS terminated at Cloudflare — proxy receives HTTP but sets `X-Forwarded-Proto: https`
- No anonymous access — Grafana requires Keycloak login
- Confidential client — client secret stored as a k8s Secret, not in version control
