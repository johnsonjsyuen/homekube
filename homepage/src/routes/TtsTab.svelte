<script lang="ts">
    import { onMount } from "svelte";
    import {
        initKeycloak,
        login,
        logout,
        onAuthStateChange,
        getToken,
        type AuthState,
    } from "$lib/auth";

    let ttsFile = $state<FileList | null>(null);
    let ttsVoice = $state("af_heart");
    let ttsSpeed = $state("1.0");
    let ttsStatus = $state<"idle" | "processing" | "completed" | "error">(
        "idle",
    );
    let ttsJobId = $state("");
    let ttsError = $state("");

    // Auth state
    let authState = $state<AuthState>({
        authenticated: false,
        token: null,
        username: null,
        roles: [],
    });
    let authInitialized = $state(false);

    // Job history state
    interface Job {
        id: string;
        status: string;
        error_message?: string;
        voice?: string;
        speed?: string;
        created_at: string;
    }
    let jobs = $state<Job[]>([]);
    let jobsLoading = $state(false);
    let jobsError = $state("");

    onMount(() => {
        // Initialize Keycloak and subscribe to auth state changes
        initKeycloak().then(() => {
            authInitialized = true;
        });

        const unsubscribe = onAuthStateChange((state) => {
            authState = state;
            // Fetch jobs when user becomes authenticated
            if (state.authenticated) {
                fetchJobs();
            } else {
                jobs = [];
            }
        });

        return unsubscribe;
    });

    async function fetchJobs() {
        jobsLoading = true;
        jobsError = "";
        try {
            const token = getToken();
            const res = await fetch("/api/tts/jobs", {
                headers: token
                    ? {
                          Authorization: `Bearer ${token}`,
                      }
                    : {},
            });

            if (!res.ok) {
                throw new Error(await res.text());
            }

            jobs = await res.json();
        } catch (e: any) {
            console.error("[TTS] Failed to fetch jobs:", e);
            jobsError = e.message;
        } finally {
            jobsLoading = false;
        }
    }

    function formatDate(dateStr: string): string {
        const date = new Date(dateStr);
        return date.toLocaleDateString("en-AU", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    function getVoiceDisplayName(voice: string | undefined): string {
        const voiceMap: Record<string, string> = {
            af_heart: "Heart",
            af_bella: "Bella",
            af_nicole: "Nicole",
            af_sky: "Sky",
            bm_daniel: "Daniel",
            bm_george: "George",
            bm_lewis: "Lewis",
        };
        return voice ? voiceMap[voice] || voice : "Unknown";
    }

    async function downloadJob(jobId: string) {
        try {
            const token = getToken();
            const res = await fetch(`/api/tts/status/${jobId}`, {
                headers: token
                    ? {
                          Authorization: `Bearer ${token}`,
                      }
                    : {},
            });

            if (!res.ok) {
                throw new Error("Failed to download");
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${jobId}.mp3`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e: any) {
            console.error("[TTS] Download failed:", e);
            alert(`Download failed: ${e.message}`);
        }
    }

    async function handleLogin() {
        // Redirect back to the TTS tab after login
        await login("/?tab=tts");
    }

    async function handleLogout() {
        await logout();
    }

    async function generateSpeech() {
        if (!authState.authenticated) {
            alert("Please log in to use text-to-speech.");
            return;
        }

        if (!ttsFile || ttsFile.length === 0) {
            alert("Please select a text file.");
            return;
        }

        ttsStatus = "processing";
        ttsError = "";
        ttsJobId = "";

        const formData = new FormData();
        formData.append("text_file", ttsFile[0]);
        formData.append("voice", ttsVoice);
        formData.append("speed", ttsSpeed);

        try {
            const token = getToken();
            const res = await fetch("/api/tts/generate", {
                method: "POST",
                body: formData,
                headers: token
                    ? {
                          Authorization: `Bearer ${token}`,
                      }
                    : {},
            });

            if (!res.ok) {
                throw new Error(await res.text());
            }

            const data = await res.json();
            console.log("[TTS] Job started, ID:", data.id);
            ttsJobId = data.id;
            pollStatus(data.id);
        } catch (e: any) {
            ttsStatus = "error";
            ttsError = e.message;
        }
    }

    // When a new job completes, refresh the job list
    $effect(() => {
        if (ttsStatus === "completed" && authState.authenticated) {
            fetchJobs();
        }
    });

    let ttsDownloadUrl = $state("");

    async function pollStatus(id: string) {
        if (ttsStatus !== "processing") {
            console.log("[TTS] Polling stopped. Status:", ttsStatus);
            return;
        }

        console.log(`[TTS] Polling status for job ${id}...`);
        try {
            const token = getToken();
            const res = await fetch(`/api/tts/status/${id}`, {
                headers: token
                    ? {
                          Authorization: `Bearer ${token}`,
                      }
                    : {},
            });
            const contentType = res.headers.get("content-type");

            if (contentType && contentType.includes("application/json")) {
                const data = await res.json();
                console.log("[TTS] Poll response:", data);
                if (data.status === "error") {
                    ttsStatus = "error";
                    ttsError = data.message;
                } else if (data.status === "processing") {
                    console.log("[TTS] Still processing. Next poll in 3s.");
                    setTimeout(() => pollStatus(id), 3 * 1000);
                }
            } else {
                console.log(
                    "[TTS] Response is not JSON (likely audio). Task completed.",
                );
                // Create a blob URL from the authenticated response for download
                const blob = await res.blob();
                ttsDownloadUrl = URL.createObjectURL(blob);
                ttsStatus = "completed";
            }
        } catch (e: any) {
            console.error("[TTS] Poll error:", e);
            ttsStatus = "error";
            ttsError = e.message;
        }
    }
</script>

<div class="tts-container">
    <div class="tts-card">
        <h3>Generate Speech</h3>

        {#if !authInitialized}
            <div class="auth-loading">
                <span class="spinner">...</span> Loading authentication...
            </div>
        {:else if !authState.authenticated}
            <div class="auth-required">
                <p>Please log in to use the text-to-speech feature.</p>
                <button class="login-btn" onclick={handleLogin}>
                    Log In
                </button>
            </div>
        {:else}
            <div class="user-info">
                <span>Logged in as: <strong>{authState.username}</strong></span>
                <button class="logout-btn" onclick={handleLogout}
                    >Log Out</button
                >
            </div>

            <div class="form-group">
                <label for="tts-file">Text File</label>
                <input
                    type="file"
                    id="tts-file"
                    accept=".txt"
                    onchange={(e) => (ttsFile = e.currentTarget.files)}
                />
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label for="tts-voice">Voice</label>
                    <select id="tts-voice" bind:value={ttsVoice}>
                        <option value="af_heart">Heart (Female)</option>
                        <option value="af_bella">Bella (Female)</option>
                        <option value="af_nicole">Nicole (Female)</option>
                        <option value="af_sky">Sky (Female)</option>
                        <option value="bm_daniel">Daniel (Male)</option>
                        <option value="bm_george">George (Male)</option>
                        <option value="bm_lewis">Lewis (Male)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="tts-speed">Speed (0.5 - 2.0)</label>
                    <input
                        type="number"
                        id="tts-speed"
                        bind:value={ttsSpeed}
                        step="0.1"
                        min="0.5"
                        max="2.0"
                    />
                </div>
            </div>

            <button
                class="generate-btn"
                onclick={generateSpeech}
                disabled={ttsStatus === "processing"}
            >
                {ttsStatus === "processing"
                    ? "Processing..."
                    : "Generate Audio"}
            </button>

            {#if ttsStatus === "processing"}
                <div class="status-msg">
                    <span class="spinner">...</span> Processing your request...
                </div>
            {/if}

            {#if ttsStatus === "completed"}
                <div class="success-msg">
                    <p>Audio generated successfully!</p>
                    <a
                        href={ttsDownloadUrl}
                        class="download-btn"
                        download="{ttsJobId}.mp3"
                    >
                        Download MP3
                    </a>
                </div>
            {/if}

            {#if ttsStatus === "error"}
                <div class="error-msg">
                    Error: {ttsError}
                </div>
            {/if}

            <!-- Job History Section -->
            <div class="job-history">
                <div class="job-history-header">
                    <h4>Job History</h4>
                    <button
                        class="refresh-btn"
                        onclick={fetchJobs}
                        disabled={jobsLoading}
                    >
                        {jobsLoading ? "⟳" : "🔄"} Refresh
                    </button>
                </div>

                {#if jobsLoading && jobs.length === 0}
                    <div class="jobs-loading">
                        <span class="spinner">...</span> Loading jobs...
                    </div>
                {:else if jobsError}
                    <div class="jobs-error">
                        Failed to load jobs: {jobsError}
                    </div>
                {:else if jobs.length === 0}
                    <div class="jobs-empty">
                        No jobs yet. Generate your first audio above!
                    </div>
                {:else}
                    <div class="jobs-table-container">
                        <table class="jobs-table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Voice</th>
                                    <th>Speed</th>
                                    <th>Status</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#each jobs as job}
                                    <tr>
                                        <td>{formatDate(job.created_at)}</td>
                                        <td>{getVoiceDisplayName(job.voice)}</td
                                        >
                                        <td>{job.speed || "1.0"}x</td>
                                        <td>
                                            {#if job.status === "completed"}
                                                <span
                                                    class="status-badge status-completed"
                                                    >✓ Done</span
                                                >
                                            {:else if job.status === "processing"}
                                                <span
                                                    class="status-badge status-processing"
                                                    >⟳ Processing</span
                                                >
                                            {:else if job.status === "error"}
                                                <span
                                                    class="status-badge status-error"
                                                    title={job.error_message}
                                                    >✗ Error</span
                                                >
                                            {:else}
                                                <span class="status-badge"
                                                    >{job.status}</span
                                                >
                                            {/if}
                                        </td>
                                        <td>
                                            {#if job.status === "completed"}
                                                <button
                                                    class="download-job-btn"
                                                    onclick={() =>
                                                        downloadJob(job.id)}
                                                >
                                                    ⬇ Download
                                                </button>
                                            {:else if job.status === "error"}
                                                <span
                                                    class="job-error-hint"
                                                    title={job.error_message}
                                                >
                                                    ⓘ
                                                </span>
                                            {:else}
                                                <span class="job-pending"
                                                    >-</span
                                                >
                                            {/if}
                                        </td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                {/if}
            </div>
        {/if}
    </div>
</div>

<style>
    .tts-container {
        display: flex;
        justify-content: center;
    }

    .tts-card {
        background: #2a2a2a;
        padding: 30px;
        border-radius: 20px;
        width: 100%;
        max-width: 500px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }

    .tts-card h3 {
        margin-top: 0;
        margin-bottom: 20px;
        text-align: center;
        color: #fff;
    }

    .auth-loading {
        text-align: center;
        color: #aaa;
        padding: 20px;
    }

    .auth-required {
        text-align: center;
        padding: 20px;
    }

    .auth-required p {
        color: #aaa;
        margin-bottom: 20px;
    }

    .login-btn {
        background: #4a90e2;
        color: white;
        border: none;
        padding: 12px 30px;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
    }

    .login-btn:hover {
        background: #357abd;
    }

    .user-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        padding: 10px 15px;
        background: #333;
        border-radius: 8px;
        font-size: 0.9rem;
    }

    .user-info span {
        color: #aaa;
    }

    .user-info strong {
        color: #fff;
    }

    .logout-btn {
        background: transparent;
        color: #f87171;
        border: 1px solid #f87171;
        padding: 5px 15px;
        border-radius: 5px;
        cursor: pointer;
        font-size: 0.85rem;
        transition: all 0.2s;
    }

    .logout-btn:hover {
        background: #f87171;
        color: #000;
    }

    .form-group {
        margin-bottom: 20px;
    }

    .form-row {
        display: flex;
        gap: 20px;
    }

    .form-row .form-group {
        flex: 1;
    }

    label {
        display: block;
        margin-bottom: 8px;
        color: #aaa;
        font-size: 0.9rem;
    }

    input[type="file"],
    input[type="number"],
    select {
        width: 100%;
        background: #333;
        border: 1px solid #444;
        color: #fff;
        padding: 10px;
        border-radius: 8px;
        font-size: 1rem;
        box-sizing: border-box;
    }

    input[type="file"]::file-selector-button {
        background: #444;
        color: #fff;
        border: none;
        padding: 8px 12px;
        border-radius: 4px;
        cursor: pointer;
        margin-right: 10px;
    }

    .generate-btn {
        width: 100%;
        background: #4a90e2;
        color: white;
        border: none;
        padding: 12px;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
    }

    .generate-btn:hover {
        background: #357abd;
    }

    .generate-btn:disabled {
        background: #444;
        cursor: not-allowed;
        color: #888;
    }

    .status-msg {
        margin-top: 20px;
        text-align: center;
        color: #aaa;
    }

    .spinner {
        display: inline-block;
        animation: pulse 1s ease-in-out infinite;
    }

    @keyframes pulse {
        0%,
        100% {
            opacity: 1;
        }
        50% {
            opacity: 0.5;
        }
    }

    .success-msg {
        margin-top: 20px;
        text-align: center;
        background: rgba(74, 222, 128, 0.1);
        padding: 15px;
        border-radius: 8px;
        border: 1px solid rgba(74, 222, 128, 0.3);
    }

    .download-btn {
        display: inline-block;
        margin-top: 10px;
        background: #4ade80;
        color: #000;
        padding: 10px 20px;
        border-radius: 20px;
        text-decoration: none;
        font-weight: 600;
    }

    .error-msg {
        margin-top: 20px;
        background: rgba(248, 113, 113, 0.1);
        color: #f87171;
        padding: 15px;
        border-radius: 8px;
        text-align: center;
        border: 1px solid rgba(248, 113, 113, 0.3);
    }

    /* Job History Styles */
    .job-history {
        margin-top: 30px;
        padding-top: 20px;
        border-top: 1px solid #444;
    }

    .job-history-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
    }

    .job-history-header h4 {
        margin: 0;
        color: #fff;
        font-size: 1rem;
    }

    .refresh-btn {
        background: transparent;
        color: #4a90e2;
        border: 1px solid #4a90e2;
        padding: 5px 12px;
        border-radius: 5px;
        cursor: pointer;
        font-size: 0.8rem;
        transition: all 0.2s;
    }

    .refresh-btn:hover {
        background: #4a90e2;
        color: #fff;
    }

    .refresh-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .jobs-loading,
    .jobs-error,
    .jobs-empty {
        text-align: center;
        padding: 20px;
        color: #aaa;
        font-size: 0.9rem;
    }

    .jobs-error {
        color: #f87171;
    }

    .jobs-table-container {
        overflow-x: auto;
    }

    .jobs-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.85rem;
    }

    .jobs-table th,
    .jobs-table td {
        padding: 10px 8px;
        text-align: left;
        border-bottom: 1px solid #3a3a3a;
    }

    .jobs-table th {
        color: #888;
        font-weight: 500;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .jobs-table td {
        color: #ccc;
    }

    .jobs-table tbody tr:hover {
        background: #333;
    }

    .status-badge {
        display: inline-block;
        padding: 3px 8px;
        border-radius: 12px;
        font-size: 0.75rem;
        font-weight: 500;
    }

    .status-completed {
        background: rgba(74, 222, 128, 0.2);
        color: #4ade80;
    }

    .status-processing {
        background: rgba(251, 191, 36, 0.2);
        color: #fbbf24;
    }

    .status-error {
        background: rgba(248, 113, 113, 0.2);
        color: #f87171;
        cursor: help;
    }

    .download-job-btn {
        background: #4ade80;
        color: #000;
        border: none;
        padding: 5px 10px;
        border-radius: 5px;
        cursor: pointer;
        font-size: 0.75rem;
        font-weight: 600;
        transition: opacity 0.2s;
    }

    .download-job-btn:hover {
        opacity: 0.8;
    }

    .job-error-hint {
        color: #f87171;
        cursor: help;
        font-size: 1rem;
    }

    .job-pending {
        color: #666;
    }
</style>
