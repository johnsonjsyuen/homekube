<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import {
        initKeycloak,
        login,
        logout,
        onAuthStateChange,
        getToken,
        type AuthState,
    } from "$lib/auth";

    // Auth state
    let authState = $state<AuthState>({
        authenticated: false,
        token: null,
        username: null,
        roles: [],
    });
    let authInitialized = $state(false);

    // Recording state
    let isRecording = $state(false);
    let transcript = $state("");
    let partialTranscript = $state("");
    let connectionStatus = $state<
        "disconnected" | "connecting" | "connected" | "error"
    >("disconnected");
    let errorMessage = $state("");
    let copyFeedback = $state(false);

    // WebSocket and audio references
    let ws: WebSocket | null = null;
    let mediaRecorder: MediaRecorder | null = null;
    let audioContext: AudioContext | null = null;
    let audioProcessor: ScriptProcessorNode | null = null;
    let mediaStream: MediaStream | null = null;

    // Get WebSocket URL based on environment
    function getWsUrl(): string {
        if (typeof window === "undefined") return "";

        // In development, connect directly to backend
        // In production, use the same host with /stt path
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

        // Check for explicit backend URL override
        const backendUrl = import.meta.env.VITE_STT_WS_URL;
        if (backendUrl) {
            return backendUrl;
        }

        // Default: use K8s service URL (in production) or localhost (in dev)
        if (window.location.hostname === "localhost") {
            return `${protocol}//localhost:3001/transcribe`;
        }

        // Production: connect to speech-to-text service
        // Strip www. prefix to avoid stt.www.domain.com
        const hostname = window.location.hostname.replace(/^www\./, "");
        return `${protocol}//stt.${hostname}/transcribe`;
    }

    onMount(() => {
        initKeycloak().then(() => {
            authInitialized = true;
        });

        const unsubscribe = onAuthStateChange((state) => {
            authState = state;
        });

        return unsubscribe;
    });

    onDestroy(() => {
        stopRecording();
        disconnectWebSocket();
    });

    async function handleLogin() {
        await login("/?tab=stt");
    }

    async function handleLogout() {
        await logout();
    }

    function connectWebSocket() {
        const token = getToken();
        if (!token) {
            errorMessage = "No authentication token available";
            connectionStatus = "error";
            return;
        }

        connectionStatus = "connecting";
        const wsUrl = `${getWsUrl()}?token=${encodeURIComponent(token)}`;

        try {
            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                console.log("[STT] WebSocket connected");
                connectionStatus = "connecting"; // Wait for server "connected" message
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    console.log("[STT] Received:", msg);

                    if (msg.type === "connected") {
                        connectionStatus = "connected";
                    } else if (msg.type === "transcript") {
                        if (msg.text) {
                            // All transcripts append - each is a completed speech segment
                            transcript += (transcript ? " " : "") + msg.text;
                        }
                    } else if (msg.type === "error") {
                        errorMessage = msg.error || "Unknown error";
                        connectionStatus = "error";
                    }
                } catch (e) {
                    console.error("[STT] Failed to parse message:", e);
                }
            };

            ws.onerror = (error) => {
                console.error("[STT] WebSocket error:", error);
                connectionStatus = "error";
                errorMessage = "WebSocket connection error";
            };

            ws.onclose = () => {
                console.log("[STT] WebSocket closed");
                if (connectionStatus !== "error") {
                    connectionStatus = "disconnected";
                }
                ws = null;
            };
        } catch (e: any) {
            console.error("[STT] Failed to connect:", e);
            connectionStatus = "error";
            errorMessage = e.message;
        }
    }

    function disconnectWebSocket() {
        if (ws) {
            ws.close();
            ws = null;
        }
        connectionStatus = "disconnected";
    }

    async function startRecording() {
        if (!authState.authenticated) {
            alert("Please log in to use speech-to-text.");
            return;
        }

        errorMessage = "";

        // Connect WebSocket first
        connectWebSocket();

        // Wait for connection
        await new Promise<void>((resolve, reject) => {
            const checkConnection = setInterval(() => {
                if (connectionStatus === "connected") {
                    clearInterval(checkConnection);
                    resolve();
                } else if (connectionStatus === "error") {
                    clearInterval(checkConnection);
                    reject(new Error(errorMessage || "Connection failed"));
                }
            }, 100);

            // Timeout after 10 seconds
            setTimeout(() => {
                clearInterval(checkConnection);
                if (connectionStatus !== "connected") {
                    reject(new Error("Connection timeout"));
                }
            }, 10000);
        }).catch((e) => {
            errorMessage = e.message;
            connectionStatus = "error";
            return;
        });

        if (connectionStatus !== "connected") return;

        try {
            // Request microphone access - don't force sample rate, use native
            mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                },
            });

            // Create audio context with native sample rate
            audioContext = new AudioContext();
            const nativeSampleRate = audioContext.sampleRate;
            const targetSampleRate = 16000;

            console.log(
                `[STT] Native sample rate: ${nativeSampleRate}, target: ${targetSampleRate}`,
            );

            const source = audioContext.createMediaStreamSource(mediaStream);

            // Use ScriptProcessor for PCM16 data (deprecated but widely supported)
            audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);

            audioProcessor.onaudioprocess = (event) => {
                if (!isRecording || !ws || ws.readyState !== WebSocket.OPEN)
                    return;

                const inputData = event.inputBuffer.getChannelData(0);

                // Resample to 16kHz if needed
                let samples: Float32Array;
                if (nativeSampleRate !== targetSampleRate) {
                    const ratio = nativeSampleRate / targetSampleRate;
                    const newLength = Math.floor(inputData.length / ratio);
                    samples = new Float32Array(newLength);
                    for (let i = 0; i < newLength; i++) {
                        samples[i] = inputData[Math.floor(i * ratio)];
                    }
                } else {
                    samples = inputData;
                }

                // Convert Float32 to PCM16
                const pcm16 = new Int16Array(samples.length);
                for (let i = 0; i < samples.length; i++) {
                    const s = Math.max(-1, Math.min(1, samples[i]));
                    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
                }

                // Convert to base64
                const uint8 = new Uint8Array(pcm16.buffer);
                let binary = "";
                for (let i = 0; i < uint8.length; i++) {
                    binary += String.fromCharCode(uint8[i]);
                }
                const base64Audio = btoa(binary);

                // Send to WebSocket with recent transcript as context
                const recentText = transcript.slice(-200);
                ws.send(
                    JSON.stringify({
                        audio: base64Audio,
                        initial_prompt: recentText,
                    }),
                );
            };

            source.connect(audioProcessor);
            audioProcessor.connect(audioContext.destination);

            isRecording = true;
            console.log("[STT] Recording started");
        } catch (e: any) {
            console.error("[STT] Failed to start recording:", e);
            errorMessage = e.message || "Failed to access microphone";
            stopRecording();
        }
    }

    function stopRecording() {
        isRecording = false;

        // Stop audio processing
        if (audioProcessor) {
            audioProcessor.disconnect();
            audioProcessor = null;
        }

        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }

        if (mediaStream) {
            mediaStream.getTracks().forEach((track) => track.stop());
            mediaStream = null;
        }

        // Send commit message to finalize transcription
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "commit" }));
        }

        console.log("[STT] Recording stopped");
    }

    async function copyToClipboard() {
        if (!transcript) return;

        try {
            await navigator.clipboard.writeText(transcript);
            copyFeedback = true;
            setTimeout(() => {
                copyFeedback = false;
            }, 2000);
        } catch (e) {
            console.error("[STT] Failed to copy:", e);
            alert("Failed to copy to clipboard");
        }
    }

    function clearTranscript() {
        transcript = "";
        partialTranscript = "";
    }
</script>

<div class="stt-container">
    <div class="stt-card">
        <h3>Speech to Text</h3>

        {#if !authInitialized}
            <div class="auth-loading">
                <span class="spinner">...</span> Loading authentication...
            </div>
        {:else if !authState.authenticated}
            <div class="auth-required">
                <p>Please log in to use the speech-to-text feature.</p>
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

            <!-- Recording Controls -->
            <div class="recording-section">
                <div class="recording-controls">
                    {#if !isRecording}
                        <button
                            class="record-btn start"
                            onclick={startRecording}
                            disabled={connectionStatus === "connecting"}
                        >
                            <span class="mic-icon">🎤</span>
                            {connectionStatus === "connecting"
                                ? "Connecting..."
                                : "Start Recording"}
                        </button>
                    {:else}
                        <button class="record-btn stop" onclick={stopRecording}>
                            <span class="stop-icon">⏹</span>
                            Stop Recording
                        </button>
                    {/if}
                </div>

                {#if isRecording}
                    <div class="recording-indicator">
                        <span class="pulse-dot"></span>
                        Recording...
                    </div>
                {/if}

                <div class="connection-status">
                    Status:
                    <span class="status-badge status-{connectionStatus}">
                        {connectionStatus}
                    </span>
                </div>
            </div>

            <!-- Transcript Display -->
            <div class="transcript-section">
                <div class="transcript-header">
                    <h4>Transcript</h4>
                    <div class="transcript-actions">
                        <button
                            class="action-btn copy-btn"
                            onclick={copyToClipboard}
                            disabled={!transcript}
                        >
                            {copyFeedback ? "✓ Copied!" : "📋 Copy All"}
                        </button>
                        <button
                            class="action-btn clear-btn"
                            onclick={clearTranscript}
                            disabled={!transcript}
                        >
                            🗑️ Clear
                        </button>
                    </div>
                </div>

                <div class="transcript-box">
                    {#if transcript || partialTranscript}
                        <p>
                            {transcript}{#if partialTranscript}<span
                                    class="partial-text"
                                    >{transcript
                                        ? " "
                                        : ""}{partialTranscript}</span
                                >{/if}
                        </p>
                    {:else}
                        <p class="placeholder">
                            Your transcription will appear here...
                        </p>
                    {/if}
                </div>
            </div>

            {#if errorMessage}
                <div class="error-msg">
                    Error: {errorMessage}
                </div>
            {/if}
        {/if}
    </div>
</div>

<style>
    .stt-container {
        display: flex;
        justify-content: center;
    }

    .stt-card {
        background: #2a2a2a;
        padding: 30px;
        border-radius: 20px;
        width: 100%;
        max-width: 700px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }

    .stt-card h3 {
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

    .recording-section {
        margin-bottom: 20px;
    }

    .recording-controls {
        display: flex;
        justify-content: center;
        margin-bottom: 15px;
    }

    .record-btn {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 15px 30px;
        border: none;
        border-radius: 50px;
        font-size: 1.1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
    }

    .record-btn.start {
        background: linear-gradient(135deg, #4ade80, #22c55e);
        color: #000;
    }

    .record-btn.start:hover:not(:disabled) {
        transform: scale(1.05);
        box-shadow: 0 4px 15px rgba(74, 222, 128, 0.4);
    }

    .record-btn.stop {
        background: linear-gradient(135deg, #f87171, #ef4444);
        color: #fff;
    }

    .record-btn.stop:hover {
        transform: scale(1.05);
        box-shadow: 0 4px 15px rgba(248, 113, 113, 0.4);
    }

    .record-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
    }

    .mic-icon,
    .stop-icon {
        font-size: 1.3rem;
    }

    .recording-indicator {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: #f87171;
        font-weight: 500;
        margin-bottom: 10px;
    }

    .pulse-dot {
        width: 10px;
        height: 10px;
        background: #f87171;
        border-radius: 50%;
        animation: pulse 1s ease-in-out infinite;
    }

    @keyframes pulse {
        0%,
        100% {
            transform: scale(1);
            opacity: 1;
        }
        50% {
            transform: scale(1.2);
            opacity: 0.7;
        }
    }

    .connection-status {
        text-align: center;
        font-size: 0.85rem;
        color: #888;
    }

    .status-badge {
        display: inline-block;
        padding: 2px 10px;
        border-radius: 12px;
        font-size: 0.75rem;
        font-weight: 500;
        text-transform: capitalize;
    }

    .status-disconnected {
        background: rgba(156, 163, 175, 0.2);
        color: #9ca3af;
    }

    .status-connecting {
        background: rgba(251, 191, 36, 0.2);
        color: #fbbf24;
    }

    .status-connected {
        background: rgba(74, 222, 128, 0.2);
        color: #4ade80;
    }

    .status-error {
        background: rgba(248, 113, 113, 0.2);
        color: #f87171;
    }

    .transcript-section {
        margin-top: 20px;
    }

    .transcript-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
    }

    .transcript-header h4 {
        margin: 0;
        color: #fff;
        font-size: 1rem;
    }

    .transcript-actions {
        display: flex;
        gap: 8px;
    }

    .action-btn {
        background: transparent;
        border: 1px solid #555;
        color: #aaa;
        padding: 5px 12px;
        border-radius: 5px;
        font-size: 0.8rem;
        cursor: pointer;
        transition: all 0.2s;
    }

    .action-btn:hover:not(:disabled) {
        border-color: #4a90e2;
        color: #4a90e2;
    }

    .action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .copy-btn {
        min-width: 100px;
    }

    .transcript-box {
        background: #1a1a1a;
        border: 1px solid #333;
        border-radius: 10px;
        padding: 20px;
        min-height: 150px;
        max-height: 300px;
        overflow-y: auto;
    }

    .transcript-box p {
        margin: 0;
        line-height: 1.6;
        color: #e0e0e0;
        white-space: pre-wrap;
    }

    .transcript-box .placeholder {
        color: #666;
        font-style: italic;
    }

    .partial-text {
        color: #888;
        font-style: italic;
        animation: partial-pulse 1.5s ease-in-out infinite;
    }

    @keyframes partial-pulse {
        0%,
        100% {
            opacity: 1;
        }
        50% {
            opacity: 0.5;
        }
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

    .spinner {
        display: inline-block;
        animation: pulse 1s ease-in-out infinite;
    }
</style>
