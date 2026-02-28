# Grafana Proxy Implementation Spec

## Keycloak Client Configuration

### Client: `grafana`

| Setting | Value |
|---------|-------|
| Client type | OpenID Connect |
| Client ID | `grafana` |
| Client authentication | **ON** (confidential) |
| Standard flow | **ON** |
| Valid redirect URIs | `https://grafana.johnsonyuen.com/*` |
| Web origins | `https://grafana.johnsonyuen.com` |

### Role Mapping

Create a `grafana-admin` realm role. Map to Grafana via JMESPath:

```
contains(realm_access.roles[*], 'grafana-admin') && 'Admin' || 'Viewer'
```

### Kubernetes Secret

```bash
kubectl create secret generic grafana-keycloak-secret \
  --from-literal=GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET=<SECRET_FROM_KEYCLOAK> \
  -n monitoring
```

## Grafana OAuth2 Settings

Added to `monitoring/values.yaml` under `grafana.grafana.ini`:

```yaml
grafana:
  grafana.ini:
    server:
      root_url: "https://grafana.johnsonyuen.com"
    auth.generic_oauth:
      enabled: true
      name: Keycloak
      client_id: grafana
      client_secret: ${GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET}
      scopes: openid profile email
      auth_url: https://auth.johnsonyuen.com/realms/homekube/protocol/openid-connect/auth
      token_url: http://keycloak.keycloak.svc.cluster.local/realms/homekube/protocol/openid-connect/token
      api_url: http://keycloak.keycloak.svc.cluster.local/realms/homekube/protocol/openid-connect/userinfo
      role_attribute_path: "contains(realm_access.roles[*], 'grafana-admin') && 'Admin' || 'Viewer'"
      allow_assign_grafana_admin: true
  envFromSecrets:
    - name: grafana-keycloak-secret
```

### URL Strategy

| Endpoint | URL | Why |
|----------|-----|-----|
| `auth_url` | `https://auth.johnsonyuen.com/...` | Browser redirect — must be externally reachable |
| `token_url` | `http://keycloak.keycloak.svc.cluster.local/...` | Server-to-server — stays in cluster |
| `api_url` | `http://keycloak.keycloak.svc.cluster.local/...` | Server-to-server — stays in cluster |

## Nginx Proxy Configuration

### `monitoring/grafana-proxy/nginx.conf`

```nginx
server {
    listen 80;
    server_name grafana.johnsonyuen.com;

    location / {
        proxy_pass http://kube-prometheus-stack-grafana.monitoring.svc.cluster.local;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

**Critical:** `X-Forwarded-Proto https` ensures Grafana constructs correct OAuth2 redirect URIs since TLS is terminated at Cloudflare.

WebSocket upgrade headers are needed for Grafana Live features.

## Kubernetes Manifests

All in `monitoring/grafana-proxy/`:

- **configmap.yaml** — nginx.conf as ConfigMap
- **deployment.yaml** — single replica, `nginx:alpine`, mounts ConfigMap
- **service.yaml** — ClusterIP port 80, `app: grafana-proxy`

Resources: 32Mi-64Mi RAM, 50m CPU.

## Cloudflare Tunnel

Manual step — add public hostname route in Cloudflare dashboard:

| Setting | Value |
|---------|-------|
| Subdomain | `grafana.johnsonyuen.com` |
| Service | `http://grafana-proxy.default.svc.cluster.local` |

## Anti-Patterns

- **Don't** use oauth2-proxy — Grafana has built-in OAuth2 support
- **Don't** use the external Keycloak URL for `token_url`/`api_url` — causes hairpin routing through Cloudflare
- **Don't** skip `X-Forwarded-Proto` — OAuth2 redirects will break (HTTP vs HTTPS mismatch)
- **Don't** deploy the proxy in the `monitoring` namespace — keep it in `default` to match Cloudflare tunnel routing pattern

## Error Handling

| Symptom | Cause | Fix |
|---------|-------|-----|
| OAuth2 redirect loop | Wrong `root_url` or missing `X-Forwarded-Proto` | Ensure `root_url` matches external URL and proxy sends `X-Forwarded-Proto: https` |
| 502 from proxy | Grafana service unreachable | Check cross-namespace DNS: `kube-prometheus-stack-grafana.monitoring.svc.cluster.local` |
| "Invalid redirect URI" from Keycloak | Redirect URI mismatch | Ensure Keycloak client has `https://grafana.johnsonyuen.com/*` in valid redirect URIs |
| User gets no role | Missing role mapping | Check `role_attribute_path` JMESPath and that `realm_access` is in the token |

## Verification

1. `kubectl get pods -l app=grafana-proxy` — nginx pod Running
2. `kubectl exec <grafana-proxy-pod> -- curl -s http://kube-prometheus-stack-grafana.monitoring.svc.cluster.local` — Grafana reachable
3. Browse `https://grafana.johnsonyuen.com` → redirects to Keycloak login
4. Login with Keycloak user → lands on Grafana as Viewer
5. Login with `grafana-admin` role user → gets Admin access
