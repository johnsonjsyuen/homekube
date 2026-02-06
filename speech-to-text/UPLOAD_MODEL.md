# Uploading Model Files (SFTP/Rsync Method)

For reliable transfer of large files (like the 9GB model), we'll spin up a temporary SFTP server attached to the PVC.

## Step 1: Start SFTP Server Pod

We use `atmoz/sftp` which is pre-configured for easy SFTP access.

```bash
# Create the PVC if you haven't already
kubectl apply -f k8s/pvc.yaml

# Run SFTP server
# Credentials: user=upload, pass=upload
kubectl run model-uploader --image=atmoz/sftp:latest --restart=Never \
  --port=22 \
  --overrides='
{
  "spec": {
    "containers": [{
      "name": "model-uploader",
      "image": "atmoz/sftp:latest",
      "args": ["upload:upload:1001:1001:upload"],
      "ports": [{"containerPort": 22}],
      "volumeMounts": [{
        "name": "model",
        "mountPath": "/home/upload/upload"
      }],
      "securityContext": {
        "privileged": true
      }
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

Wait for it to be ready:
```bash
kubectl wait --for=condition=Ready pod/model-uploader --timeout=60s
```

## Step 2: Port Forward

Forward local port 2222 to the pod's port 22:

```bash
kubectl port-forward pod/model-uploader 2222:22 &
PID=$!
```

## Step 3: Upload with SFTP


```bash
sftp -P 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null upload@localhost
```

Enter password: `upload`

Inside the `sftp>` prompt:

```bash
cd upload
put consolidated.safetensors
put params.json
put tekken.json
bye
```

> **Note**: This will take some time for the 9GB file. The progress bar will show the speed.

## Step 4: Cleanup

```bash
# Kill port-forward
kill $PID

# Delete pod
kubectl delete pod model-uploader

# Deploy app
kubectl apply -f k8s/
```
