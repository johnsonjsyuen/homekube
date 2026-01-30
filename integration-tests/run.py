#!/usr/bin/env python3
import subprocess
import sys
import time
import atexit
import os
import signal
import json
import shutil

# Configuration
CLUSTER_NAME = "integration-test"
KUBECTL = "kubectl"
KIND = "kind"
DOCKER = "docker"
NERDCTL = "nerdctl"
REPO_ROOT = subprocess.check_output(["git", "rev-parse", "--show-toplevel"]).decode().strip()

# Global state
CLEANUP_ACTIONS = []
USING_NERDCTL = False

def log(message):
    timestamp = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    print(f"[{timestamp}] {message}")

def run_command(command, check=True, capture_output=False, shell=False):
    """Runs a command and returns the result."""
    try:
        result = subprocess.run(
            command,
            check=check,
            capture_output=capture_output,
            text=True,
            shell=shell,
            cwd=REPO_ROOT
        )
        return result
    except subprocess.CalledProcessError as e:
        if check:
            log(f"Error running command: {command}")
            if e.stdout:
                print(f"Stdout: {e.stdout}")
            if e.stderr:
                print(f"Stderr: {e.stderr}")
            raise
        return e

def check_dependencies():
    global DOCKER, USING_NERDCTL
    log("Checking dependencies...")
    
    if not shutil.which(KUBECTL):
        log(f"{KUBECTL} is not installed. Please install it.")
        sys.exit(1)

    # Helper to check if a runtime is functional
    def is_runtime_functional(binary):
        if not shutil.which(binary):
            return False
        try:
            # Run 'info' to check connectivity
            run_command([binary, "info"], check=True, capture_output=True)
            return True
        except subprocess.CalledProcessError:
            return False

    # Check for Docker or Nerdctl
    if is_runtime_functional(DOCKER):
        log(f"Found working {DOCKER}.")
    elif is_runtime_functional(NERDCTL):
        log(f"Found working {NERDCTL}. Using it as container runtime.")
        DOCKER = NERDCTL
        USING_NERDCTL = True
    else:
        log(f"Neither {DOCKER} nor {NERDCTL} is installed or running. Please ensure a container runtime is active.")
        log(f"Current PATH: {os.environ.get('PATH')}")
        sys.exit(1)

def get_current_context():
    try:
        result = run_command([KUBECTL, "config", "current-context"], capture_output=True)
        return result.stdout.strip()
    except:
        return ""

def get_contexts():
    try:
        result = run_command([KUBECTL, "config", "get-contexts", "-o", "name"], capture_output=True)
        return result.stdout.strip().splitlines()
    except:
        return []

def cleanup():
    log("Cleaning up...")
    # Execute cleanup actions in reverse order
    for action in reversed(CLEANUP_ACTIONS):
        try:
            action()
        except Exception as e:
            log(f"Error during cleanup: {e}")

def register_cleanup(action):
    CLEANUP_ACTIONS.append(action)

def setup_cluster():
    contexts = get_contexts()
    use_rancher = False
    
    # Check for Rancher Desktop context
    # Rancher Desktop usually sets context to 'rancher-desktop'
    if "rancher-desktop" in contexts:
        log("Detected Rancher Desktop context. Using it.")
        run_command([KUBECTL, "config", "use-context", "rancher-desktop"])
        use_rancher = True
        
        # Register cleanup for Rancher Desktop (delete resources)
        def cleanup_rancher_resources():
            log("Deleting deployed resources...")
            # We delete the resources we created. 
            resources = [
                "speedtest/k8s/deployment.yaml",
                "speedtest/k8s/service.yaml",
                "speedtest/k8s/postgres-cluster.yaml",
                "homepage/homepage-deployment.yaml",
            ]
            for res in resources:
                try:
                    run_command([KUBECTL, "delete", "-f", res, "--ignore-not-found"], check=False)
                except:
                    pass
        
        register_cleanup(cleanup_rancher_resources)

    else:
        # Fallback to Kind
        if not shutil.which(KIND):
            log("kind is not installed and Rancher Desktop not detected. Please install kind.")
            sys.exit(1)
            
        log(f"Creating Kind cluster '{CLUSTER_NAME}'...")
        
        # Check if cluster exists
        clusters = run_command([KIND, "get", "clusters"], capture_output=True).stdout.strip().splitlines()
        if CLUSTER_NAME in clusters:
            log(f"Cluster '{CLUSTER_NAME}' already exists. Using it.")
        else:
            run_command([KIND, "create", "cluster", "--name", CLUSTER_NAME])
        
        run_command([KUBECTL, "config", "use-context", f"kind-{CLUSTER_NAME}"])
        
        # Register cleanup for Kind (delete cluster)
        def cleanup_kind_cluster():
            log(f"Deleting Kind cluster '{CLUSTER_NAME}'...")
            run_command([KIND, "delete", "cluster", "--name", CLUSTER_NAME], check=False)
        
        register_cleanup(cleanup_kind_cluster)

    run_command([KUBECTL, "cluster-info"])
    return use_rancher

def install_cnpg():
    log("Installing CloudNativePG operator...")
    cnpg_url = "https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.28/releases/cnpg-1.28.0.yaml"
    run_command([KUBECTL, "apply", "--server-side", "-f", cnpg_url])
    
    log("Waiting for CloudNativePG operator to be ready...")
    run_command([KUBECTL, "rollout", "status", "deployment", "-n", "cnpg-system", "cnpg-controller-manager", "--timeout=300s"])

def build_image(tag, path):
    cmd = [DOCKER, "build", "-t", tag, path]
    if USING_NERDCTL:
        cmd.extend(["--namespace", "k8s.io"])
    run_command(cmd)

def test_homepage(use_rancher):
    log("Testing Homepage app...")
    
    log("Building Homepage image...")
    build_image("homepage:test", "./homepage")
    
    if not use_rancher:
        log("Loading Homepage image into Kind...")
        run_command([KIND, "load", "docker-image", "homepage:test", "--name", CLUSTER_NAME])
    
    log("Deploying Homepage...")
    run_command([KUBECTL, "apply", "-f", "homepage/homepage-deployment.yaml"])
    
    # Patch image and pull policy
    run_command([KUBECTL, "set", "image", "deployment/homepage", "homepage=homepage:test"])
    run_command([KUBECTL, "patch", "deployment", "homepage", "-p", '{"spec":{"template":{"spec":{"containers":[{"name":"homepage","imagePullPolicy":"Never"}]}}}}'])
    
    log("Waiting for Homepage deployment rollout...")
    run_command([KUBECTL, "rollout", "status", "deployment/homepage", "--timeout=120s"])
    
    log("Verifying Homepage availability...")
    port = 30080
    
    # Start port-forward
    pf_process = subprocess.Popen(
        [KUBECTL, "port-forward", "svc/homepage", f"{port}:80"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    
    def cleanup_pf():
        if pf_process.poll() is None:
            pf_process.terminate()
            pf_process.wait()
            
    register_cleanup(cleanup_pf)
    
    # Wait for port-forward
    time.sleep(10)
    
    try:
        response = run_command(["curl", "-s", f"http://localhost:{port}"], capture_output=True).stdout
        if "Weather" in response or "Temperature" in response:
            log("Homepage is accessible and displaying weather data.")
        else:
            log("Failed to access Homepage or weather data not found.")
            log(f"Response content: {response}")
            sys.exit(1)
    except Exception as e:
        log(f"Error checking homepage: {e}")
        sys.exit(1)
    finally:
        cleanup_pf()
        # Remove from cleanup list since we handled it
        if cleanup_pf in CLEANUP_ACTIONS:
            CLEANUP_ACTIONS.remove(cleanup_pf)

def test_speedtest(use_rancher):
    log("Testing Speedtest app...")
    
    log("Building Speedtest image...")
    build_image("speedtest:test", "./speedtest")
    
    if not use_rancher:
        log("Loading Speedtest image into Kind...")
        run_command([KIND, "load", "docker-image", "speedtest:test", "--name", CLUSTER_NAME])
    
    log("Creating Speedtest DB Secret...")
    run_command([KUBECTL, "delete", "secret", "speedtest-db-app-user", "--ignore-not-found"])
    run_command([KUBECTL, "create", "secret", "generic", "speedtest-db-app-user", 
                 "--from-literal=username=app", 
                 "--from-literal=password=password"])
    
    def cleanup_secret():
        run_command([KUBECTL, "delete", "secret", "speedtest-db-app-user", "--ignore-not-found"], check=False)
    register_cleanup(cleanup_secret)
    
    log("Deploying Speedtest Postgres Cluster...")
    run_command([KUBECTL, "apply", "-f", "speedtest/k8s/postgres-cluster.yaml"])
    
    log("Waiting for Postgres Cluster to be ready...")
    run_command([KUBECTL, "wait", "--for=condition=Ready", "cluster/speedtest-db", "--timeout=300s"])
    
    log("Deploying Speedtest App...")
    run_command([KUBECTL, "apply", "-f", "speedtest/k8s/service.yaml"])
    run_command([KUBECTL, "apply", "-f", "speedtest/k8s/deployment.yaml"])
    
    # Patch image and pull policy
    run_command([KUBECTL, "set", "image", "deployment/speedtest", "speedtest=speedtest:test"])
    run_command([KUBECTL, "patch", "deployment", "speedtest", "-p", '{"spec":{"template":{"spec":{"containers":[{"name":"speedtest","imagePullPolicy":"Never"}]}}}}'])
    
    log("Waiting for Speedtest deployment rollout...")
    run_command([KUBECTL, "rollout", "status", "deployment/speedtest", "--timeout=120s"])
    
    log("Verifying Speedtest availability...")
    port = 30081
    
    # Start port-forward
    pf_process = subprocess.Popen(
        [KUBECTL, "port-forward", "svc/speedtest", f"{port}:80"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    
    def cleanup_pf():
        if pf_process.poll() is None:
            pf_process.terminate()
            pf_process.wait()
            
    register_cleanup(cleanup_pf)
    
    time.sleep(10)
    
    try:
        response = run_command(["curl", "-s", f"http://localhost:{port}/api/results"], capture_output=True).stdout
        if response.strip().startswith("["):
            log("Speedtest API is accessible and returned a JSON array.")
        else:
            log("Failed to access Speedtest API or invalid response.")
            log(f"Response content: {response}")
            sys.exit(1)
    except Exception as e:
        log(f"Error checking speedtest: {e}")
        sys.exit(1)
    finally:
        cleanup_pf()
        if cleanup_pf in CLEANUP_ACTIONS:
            CLEANUP_ACTIONS.remove(cleanup_pf)

def test_text_to_speech(use_rancher):
    log("Testing Text-to-Speech app...")
    
    log("Building Text-to-Speech image...")
    build_image("text-to-speech:test", "./text-to-speech")
    
    if not use_rancher:
        log("Loading Text-to-Speech image into Kind...")
        run_command([KIND, "load", "docker-image", "text-to-speech:test", "--name", CLUSTER_NAME])
    
    log("Deploying Text-to-Speech Postgres Cluster...")
    run_command([KUBECTL, "apply", "-f", "text-to-speech/k8s/db.yaml"])
    
    log("Waiting for Postgres Cluster to be ready...")
    run_command([KUBECTL, "wait", "--for=condition=Ready", "cluster/text-to-speech-db", "--timeout=300s"])
    
    log("Deploying Text-to-Speech App...")
    run_command([KUBECTL, "apply", "-f", "text-to-speech/k8s/pvc.yaml"])
    run_command([KUBECTL, "apply", "-f", "text-to-speech/k8s/service.yaml"])
    run_command([KUBECTL, "apply", "-f", "text-to-speech/k8s/deploy.yaml"])
    
    # Patch image and pull policy
    run_command([KUBECTL, "set", "image", "deployment/text-to-speech", "text-to-speech=text-to-speech:test"])
    run_command([KUBECTL, "patch", "deployment", "text-to-speech", "-p", '{"spec":{"template":{"spec":{"containers":[{"name":"text-to-speech","imagePullPolicy":"Never"}]}}}}'])
    
    log("Waiting for Text-to-Speech deployment rollout...")
    run_command([KUBECTL, "rollout", "status", "deployment/text-to-speech", "--timeout=120s"])
    
    log("Verifying Text-to-Speech availability...")
    port = 30082
    
    # Start port-forward
    pf_process = subprocess.Popen(
        [KUBECTL, "port-forward", "svc/text-to-speech", f"{port}:80"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    
    def cleanup_pf():
        if pf_process.poll() is None:
            pf_process.terminate()
            pf_process.wait()
            
    register_cleanup(cleanup_pf)
    
    time.sleep(10)
    
    try:
        # Create a dummy text file
        test_file = "test_speech.txt"
        with open(test_file, "w") as f:
            f.write("Hello, integration test.")
            
        def cleanup_test_file():
            if os.path.exists(test_file):
                os.remove(test_file)
        register_cleanup(cleanup_test_file)

        # 1. Generate Speech
        log("Sending generation request...")
        curl_cmd = [
            "curl", "-s", "-X", "POST",
            "-F", f"text_file=@{test_file}",
            "-F", "voice=af_heart",
            "-F", "speed=1.0",
            f"http://localhost:{port}/generate"
        ]
        response = run_command(curl_cmd, capture_output=True).stdout
        log(f"Generate response: {response}")
        
        try:
            data = json.loads(response)
            job_id = data.get("id")
            if not job_id:
                raise Exception("No ID returned")
        except:
             log("Failed to parse generation response.")
             sys.exit(1)
             
        # 2. Poll Status
        log(f"Polling status for job {job_id}...")
        start_wait = time.time()
        completed = False
        while time.time() - start_wait < 60: # 60s timeout
            status_res = run_command(["curl", "-s", "-I", f"http://localhost:{port}/status/{job_id}"], capture_output=True).stdout
            
            # Check headers for content-type
            # processing returns JSON, completed returns audio/mpeg
            if "audio/mpeg" in status_res:
                log("Job completed and audio is ready.")
                completed = True
                break
                
            time.sleep(2)
            
        if not completed:
            log("Timeout waiting for TTS generation.")
            sys.exit(1)
            
    except Exception as e:
        log(f"Error checking text-to-speech: {e}")
        sys.exit(1)
    finally:
        cleanup_pf()
        if cleanup_pf in CLEANUP_ACTIONS:
            CLEANUP_ACTIONS.remove(cleanup_pf)

def main():
    # Register cleanup handler
    atexit.register(cleanup)
    signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(1))
    signal.signal(signal.SIGINT, lambda signum, frame: sys.exit(1))
    
    check_dependencies()
    use_rancher = setup_cluster()
    install_cnpg()
    test_homepage(use_rancher)
    test_speedtest(use_rancher)
    test_text_to_speech(use_rancher)
    
    log("Integration tests passed successfully!")

if __name__ == "__main__":
    main()
