import sys
import anyio
import dagger

async def main():
    async with dagger.Connection(dagger.Config(log_output=sys.stderr)) as client:
        # 1. Define the Docker-in-Docker service
        # We need privileged mode for dind to work correctly
        dockerd = (
            client.container()
            .from_("docker:24.0-dind")
            .with_mounted_cache(
                "/var/lib/docker",
                client.cache_volume("docker-lib"),
            )
            .with_exposed_port(2375)
            .with_exec(
                ["dockerd", "--host=tcp://0.0.0.0:2375", "--tls=false"],
                insecure_root_capabilities=True
            )
        )

        # 2. Define the Test Runner Container
        # Uses python to run the existing test script
        runner = (
            client.container()
            .from_("python:3.11-slim-bookworm")
            .with_service_binding("docker", dockerd)
            .with_env_variable("DOCKER_HOST", "tcp://docker:2375")
            # Install necessary tools
            .with_exec(["apt-get", "update"])
            .with_exec([
                "apt-get", "install", "-y", 
                "curl", "docker.io", "git"
            ])
            # Install kubectl
            .with_exec([
                "curl", "-LO", 
                "https://dl.k8s.io/release/v1.28.0/bin/linux/amd64/kubectl"
            ])
            .with_exec(["chmod", "+x", "./kubectl"])
            .with_exec(["mv", "./kubectl", "/usr/local/bin/kubectl"])
            # Install kind
            .with_exec([
                "curl", "-Lo", "./kind", 
                "https://kind.sigs.k8s.io/dl/v0.26.0/kind-linux-amd64"
            ])
            .with_exec(["chmod", "+x", "./kind"])
            .with_exec(["mv", "./kind", "/usr/local/bin/kind"])
            # verify installs
            .with_exec(["kubectl", "version", "--client"])
            .with_exec(["kind", "--version"])
            .with_exec(["docker", "--version"])
            # Mount source code
            .with_workdir("/src")
            .with_directory("/src", client.host().directory("."))
            # Pre-create the Kind cluster and patch kubeconfig
            # This is necessary because Kind runs in the runner container but the
            # Docker daemon is in the service container. Kubeconfig defaults to
            # 127.0.0.1, but the API server is reachable via the 'docker' hostname.
            .with_exec(["kind", "create", "cluster", "--name", "integration-test"])
            .with_exec(["sed", "-i", "s/127.0.0.1/docker/g", "/root/.kube/config"])
            .with_exec(["sed", "-i", "s/0.0.0.0/docker/g", "/root/.kube/config"])
            # Run the test script
            # We skip explicit 'integration-tests/run.sh' and run python directly 
            # to avoid shell dependency if bash is missing (though it likely isn't)
            .with_exec(["python3", "integration-tests/run.py"])
        )

        # Execute the pipeline
        print("Starting integration tests...")
        out = await runner.stdout()
        print(out)

if __name__ == "__main__":
    anyio.run(main)
