# Uploading Model Files to PVC

## Step 1: Create the PVC

```bash
kubectl apply -f k8s/pvc.yaml
```

## Step 2: Create a temporary pod to copy files

```bash
kubectl run model-uploader --image=busybox --restart=Never \
  --overrides='
{
  "spec": {
    "containers": [{
      "name": "model-uploader",
      "image": "busybox",
      "command": ["sleep", "3600"],
      "volumeMounts": [{
        "name": "model",
        "mountPath": "/model"
      }]
    }],
    "volumes": [{
      "name": "model",
      "persistentVolumeClaim": {
        "claimName": "voxtral-model"
      }
    }]
  }
}'
```

Wait for the pod to be ready:
```bash
kubectl wait --for=condition=Ready pod/model-uploader --timeout=60s
```

## Step 3: Copy model files

From your local `speech-to-text/` directory:

```bash
kubectl cp consolidated.safetensors model-uploader:/model/
kubectl cp params.json model-uploader:/model/
kubectl cp tekken.json model-uploader:/model/
```

> **Note**: The `consolidated.safetensors` file is ~9GB. This may take several minutes.

## Step 4: Verify files

```bash
kubectl exec model-uploader -- ls -lh /model/
```

You should see:
```
consolidated.safetensors   ~8.9G
params.json                ~1.3K
tekken.json                ~15M
```

## Step 5: Clean up temporary pod

```bash
kubectl delete pod model-uploader
```

## Step 6: Deploy the application

```bash
kubectl apply -f k8s/
```
