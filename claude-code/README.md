# Claude Code Service

Persistent Claude Code pod for the news-worker to `kubectl exec` into for AI summarisation.

## Prerequisites

Create the API key secret:

```bash
kubectl create secret generic claude-code-api-key --from-literal=api-key=YOUR_KEY
```

## Build & Deploy

```bash
./build.sh
```

## Initial Login

After first deploy, exec into the pod and run `claude` to complete initial setup:

```bash
kubectl exec -it deployment/claude-code -- bash
claude
```

Accept the terms and verify it connects. The config is persisted in the PVC at `/home/node/.claude`.

## How News-Worker Uses It

The news-worker finds this pod via label selector (`app=claude-code` in namespace `default`) and runs:

```bash
kubectl exec <pod> -- claude -p "summarise these articles..." --output-format text
```

Environment variables in news-worker deployment:
- `CLAUDE_CODE_NAMESPACE=default`
- `CLAUDE_CODE_LABEL=app=claude-code`
