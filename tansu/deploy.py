import subprocess
import time
import sys
import os

def run_command(command, check=True):
    """Runs a shell command and prints the output."""
    print(f"Running: {command}")
    try:
        result = subprocess.run(command, shell=True, check=check, text=True, capture_output=True)
        print(result.stdout)
        return result
    except subprocess.CalledProcessError as e:
        print(f"Error running command: {command}")
        print(e.stderr)
        if check:
            sys.exit(1)
        return e

def wait_for_pod_ready(label_selector, timeout=300):
    """Waits for a pod with the given label to be ready."""
    print(f"Waiting for pod with label {label_selector} to be ready...")
    start_time = time.time()
    while time.time() - start_time < timeout:
        # Get pod name
        cmd = f"kubectl get pods -l {label_selector} -o jsonpath='{{.items[0].metadata.name}}'"
        result = run_command(cmd, check=False)
        if result.returncode != 0 or not result.stdout.strip():
            time.sleep(5)
            continue
        
        pod_name = result.stdout.strip()
        
        # Check readiness
        cmd = f"kubectl get pod {pod_name} -o jsonpath='{{.status.conditions[?(@.type==\"Ready\")].status}}'"
        result = run_command(cmd, check=False)
        if result.stdout.strip() == "True":
            print(f"Pod {pod_name} is ready.")
            return pod_name
        
        print(f"Pod {pod_name} is not ready yet. Retrying...")
        time.sleep(5)
    
    print(f"Timeout waiting for pod with label {label_selector}")
    sys.exit(1)

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    k8s_dir = os.path.join(script_dir, "k8s")
    sql_dir = os.path.join(script_dir, "sql")
    
    # 1. Apply All Manifests (Database + Application)
    print("--- Applying All K8s Manifests ---")
    # This applies all YAML files in the k8s directory.
    # Note: The Tansu pod will likely crash loop until the DB is ready and schema is applied.
    run_command(f"kubectl apply -f {k8s_dir}")
    
    # 2. Wait for Database to be Ready
    db_pod_name = "tansu-db-1"
    
    print(f"--- Waiting for {db_pod_name} ---")
    start_time = time.time()
    while time.time() - start_time < 300:
        cmd = f"kubectl get pod {db_pod_name} -o jsonpath='{{.status.conditions[?(@.type==\"Ready\")].status}}'"
        result = run_command(cmd, check=False)
        if result.stdout.strip() == "True":
            print(f"Pod {db_pod_name} is ready.")
            break
        print(f"Waiting for {db_pod_name} to be ready...")
        time.sleep(5)
    else:
         print(f"Timeout waiting for {db_pod_name}")
         sys.exit(1)

    # 3. Apply Schema and Grants
    print("--- Applying Schema and Grants ---")
    schema_path = os.path.join(sql_dir, "schema.sql")
    grant_path = os.path.join(sql_dir, "grant.sql")
    
    # Copy files to pod
    run_command(f"kubectl cp {schema_path} {db_pod_name}:/var/lib/postgresql/data/schema.sql")
    run_command(f"kubectl cp {grant_path} {db_pod_name}:/var/lib/postgresql/data/grant.sql")
    
    # Execute SQL
    run_command(f"kubectl exec {db_pod_name} -- psql -U postgres -d tansu -f /var/lib/postgresql/data/schema.sql")
    run_command(f"kubectl exec {db_pod_name} -- psql -U postgres -d tansu -f /var/lib/postgresql/data/grant.sql")
    
    # 4. Restart Tansu Deployment
    # This ensures the application picks up the schema changes and reconnects properly.
    print("--- Restarting Tansu Deployment ---")
    run_command("kubectl rollout restart deployment tansu")
    
    print("--- Deployment Complete ---")

if __name__ == "__main__":
    main()
