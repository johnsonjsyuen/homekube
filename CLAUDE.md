# Homekube Project Guidelines

## Service Patterns

- **CORS origins**: The web frontend is at `https://www.johnsonyuen.com`, NOT `home.johnsonyuen.com`. Always include `https://www.johnsonyuen.com` in CORS allow_origins for new services.
- **Keycloak auth**: All services use `audience=any` / `verify_aud=false`. Do NOT enforce a specific audience claim — the Keycloak tokens don't include one.
- **Environment variables for containers**: Set env vars in k8s deployment manifests (`k8s/deploy.yaml`), not via `os.environ.setdefault()` in application code. Application code runs too late for libraries that read env vars at import time.
- **Cloudflare Tunnel**: Ingress is via Cloudflare Tunnel (token-based, managed in dashboard). No k8s Ingress resources needed. Tunnel pods are in `cloudflare` namespace. Internal service URLs use `http://<service>.<namespace>` format.

## Common Pitfalls

- **homepage and homepage-app duplication**: These two apps share identical tab components (e.g. OcrTab.svelte). Do NOT use symlinks — always update both files when making changes. Docker build breaks with cross-context symlinks.
