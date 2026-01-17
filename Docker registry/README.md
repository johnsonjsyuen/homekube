# Local Docker Registry

This directory contains a script to start a local Docker registry on port 5000.

## Prerequisites

- Ubuntu PC
- Docker installed
- K3s installed

## Starting the Registry

Run the startup script:

```bash
./start_registry.sh
```

*Note: You may need to run this with `sudo` if your user is not part of the `docker` group.*

This will start a Docker container named `local-registry` listening on port 5000.

## Configuring K3s

To allow K3s to pull images from this insecure (HTTP) registry, you need to configure `registries.yaml`.

1.  Create or edit `/etc/rancher/k3s/registries.yaml`:

    ```bash
    sudo nano /etc/rancher/k3s/registries.yaml
    ```

2.  Add the following configuration:

    ```yaml
    mirrors:
      "localhost:5000":
        endpoint:
          - "http://localhost:5000"
    ```

    *Note: If you are accessing the registry from a different node, replace `localhost` with the IP address of the machine running the registry.*

3.  Restart K3s to apply changes:

    ```bash
    sudo systemctl restart k3s
    ```

## Using the Registry

### 1. Tag and Push an Image

Pull an image (e.g., `busybox`), tag it for your local registry, and push it.

```bash
# Pull an example image
docker pull busybox

# Tag it for the local registry
docker tag busybox localhost:5000/my-busybox:latest

# Push it to the local registry
docker push localhost:5000/my-busybox:latest
```

### 2. Use the Image in K3s

You can now use this image in your Kubernetes manifests.

Create a file named `test-pod.yaml`:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: test-local-registry
spec:
  containers:
  - name: busybox
    image: localhost:5000/my-busybox:latest
    command: ["sh", "-c", "echo Hello from local registry && sleep 3600"]
```

Apply it:

```bash
kubectl apply -f test-pod.yaml
```

Check the status:

```bash
kubectl get pod test-local-registry
```
