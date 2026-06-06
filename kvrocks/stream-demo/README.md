# Kvrocks Stream Consumer Group Demo

Small Rust demo for Redis-compatible streams against the in-cluster `kvrocks` service.

It demonstrates:

- `XGROUP CREATE ... MKSTREAM` to create a stream and consumer group.
- `XADD` to publish demo messages.
- `XREADGROUP GROUP ... STREAMS <stream> >` with two consumers.
- `XACK` after each consumer processes a message.
- `XPENDING` to show the group has no unacked messages at the end.

## Run Locally With Port Forwarding

```bash
kubectl port-forward svc/kvrocks 6666:6666
```

In another shell:

```bash
cd kvrocks/stream-demo
KVROCKS_URL=redis://127.0.0.1:6666 cargo run
```

## Run In Kubernetes

Build and push the image to your registry, then update `k8s/job.yaml`:

```bash
docker build -t your-registry/kvrocks-stream-demo:latest kvrocks/stream-demo
docker push your-registry/kvrocks-stream-demo:latest
```

Apply the job:

```bash
kubectl apply -f kvrocks/stream-demo/k8s/job.yaml
kubectl logs job/kvrocks-stream-demo -f
```

## Configuration

Environment variables:

- `KVROCKS_URL`, default `redis://kvrocks:6666`
- `STREAM_NAME`, default `demo:stream`
- `GROUP_NAME`, default `demo-group`
- `MESSAGE_COUNT`, default `12`
