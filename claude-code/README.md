# Claude Code Service

Persistent Claude Code pod for the news-worker to `kubectl exec` into for AI summarisation.

## Build & Deploy

```bash
./build.sh
```

## Login

Exec into the pod and run `claude` to authenticate:

```bash
kubectl exec -it deployment/claude-code -- bash
claude
```

Follow the OAuth prompts to log in via browser. The config is persisted in the PVC at `/home/node/.claude`.

Alternatively, create a secret with an API key (optional):

```bash
kubectl create secret generic claude-code-api-key --from-literal=api-key=YOUR_KEY
```

## How News-Worker Uses It

The news-worker finds this pod via label selector (`app=claude-code` in namespace `default`) and runs:

```bash
kubectl exec <pod> -- claude -p "summarise these articles..." --output-format text
```

Environment variables in news-worker deployment:
- `CLAUDE_CODE_NAMESPACE=default`
- `CLAUDE_CODE_LABEL=app=claude-code`
