<script lang="ts">
    import { onMount } from 'svelte';
    import { initKeycloak, login, logout, onAuthStateChange, getToken, type AuthState } from '$lib/auth';

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
        roles: []
    });
    let authInitialized = $state(false);

    onMount(() => {
        // Initialize Keycloak and subscribe to auth state changes
        initKeycloak().then(() => {
            authInitialized = true;
        });

        const unsubscribe = onAuthStateChange((state) => {
            authState = state;
        });

        return unsubscribe;
    });

    async function handleLogin() {
        // Redirect back to the TTS tab after login
        await login('/?tab=tts');
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
                headers: token ? {
                    'Authorization': `Bearer ${token}`
                } : {}
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

    async function pollStatus(id: string) {
        if (ttsStatus !== "processing") {
            console.log("[TTS] Polling stopped. Status:", ttsStatus);
            return;
        }

        console.log(`[TTS] Polling status for job ${id}...`);
        try {
            const token = getToken();
            const res = await fetch(`/api/tts/status/${id}`, {
                headers: token ? {
                    'Authorization': `Bearer ${token}`
                } : {}
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
                    setTimeout(() => pollStatus(id), 3*1000);
                }
            } else {
                console.log(
                    "[TTS] Response is not JSON (likely audio). Task completed.",
                );
                // Audio file is ready (stream)
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
                <button class="logout-btn" onclick={handleLogout}>Log Out</button>
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
                {ttsStatus === "processing" ? "Processing..." : "Generate Audio"}
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
                        href="/api/tts/status/{ttsJobId}"
                        class="download-btn"
                        download
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
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
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
</style>
