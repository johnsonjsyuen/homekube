import subprocess
import time
import os
import json
import sys

def run_command(command):
    print(f"Running: {' '.join(command)}")
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Command failed: {result.stderr}")
        raise Exception(f"Command failed: {' '.join(command)}")
    return result.stdout.strip()

def main():
    network_name = "tts-integration-net"
    postgres_container = "tts-postgres-test"
    app_container = "tts-app-test"
    image_name = "tts-app-test-image"

    try:
        # Cleanup potential leftovers
        print("Cleaning up any existing containers...")
        subprocess.run(["docker", "rm", "-f", postgres_container, app_container], capture_output=True)
        subprocess.run(["docker", "network", "rm", network_name], capture_output=True)

        print("Creating Docker network...")
        run_command(["docker", "network", "create", network_name])

        print("Starting Postgres...")
        run_command([
            "docker", "run", "-d",
            "--name", postgres_container,
            "--network", network_name,
            "-e", "POSTGRES_PASSWORD=password",
            "-e", "POSTGRES_USER=user",
            "-e", "POSTGRES_DB=tts",
            "postgres:15-alpine"
        ])

        # Wait for Postgres to start
        time.sleep(5)

        print("Building TTS Image...")
        run_command(["docker", "build", "-t", image_name, "text-to-speech"])

        print("Starting TTS App...")
        # Use port 3001 to avoid conflict with default 3000 if used elsewhere
        run_command([
            "docker", "run", "-d",
            "--name", app_container,
            "--network", network_name,
            "-p", "3001:3000",
            "-e", "DATABASE_URL=postgres://user:password@tts-postgres-test/tts",
            image_name
        ])

        print("Waiting for App to be ready...")
        time.sleep(5)

        print("Creating test file...")
        with open("test_tts_input.txt", "w") as f:
            f.write("Hello world, this is a test.")

        print("Sending Generate Request...")
        curl_cmd = [
            "curl", "-s", "-X", "POST",
            "-F", "text_file=@test_tts_input.txt",
            "-F", "voice=af_heart",
            "-F", "speed=1.0",
            "http://localhost:3001/generate"
        ]

        # Retry logic for the initial request in case app takes longer to start
        response = ""
        for i in range(10):
            try:
                response = run_command(curl_cmd)
                if response:
                    break
            except Exception:
                print("App not ready, retrying...")
                time.sleep(2)

        print(f"Generate Response: {response}")

        try:
            job_data = json.loads(response)
            job_id = job_data.get("id")
        except:
            print("Failed to parse response")
            raise Exception(f"Invalid response: {response}")

        if not job_id:
            raise Exception("Failed to get job ID")

        print(f"Job ID: {job_id}")

        print("Polling Status...")
        start_time = time.time()
        success = False
        while time.time() - start_time < 60:
            # Check headers
            header_cmd = ["curl", "-s", "-I", f"http://localhost:3001/status/{job_id}"]
            header_out = run_command(header_cmd)

            if "audio/mpeg" in header_out:
                print("Job Completed! Audio is ready.")
                success = True
                break

            # Check body for error
            body_cmd = ["curl", "-s", f"http://localhost:3001/status/{job_id}"]
            body_out = run_command(body_cmd)
            try:
                body_json = json.loads(body_out)
                if body_json.get("status") == "error":
                    raise Exception(f"Job failed with error: {body_json.get('message')}")
            except json.JSONDecodeError:
                pass

            print("Status: Processing...")
            time.sleep(2)

        if not success:
            raise Exception("Timed out waiting for TTS completion")

        print("Integration Test Passed!")

    except Exception as e:
        print(f"Test Failed: {e}")
        # Print logs for debugging
        print("--- Postgres Logs ---")
        subprocess.run(["docker", "logs", postgres_container])
        print("--- App Logs ---")
        subprocess.run(["docker", "logs", app_container])
        sys.exit(1)
    finally:
        print("Cleaning up...")
        subprocess.run(["docker", "rm", "-f", postgres_container, app_container], capture_output=True)
        subprocess.run(["docker", "network", "rm", network_name], capture_output=True)
        if os.path.exists("test_tts_input.txt"):
            os.remove("test_tts_input.txt")

if __name__ == "__main__":
    main()
