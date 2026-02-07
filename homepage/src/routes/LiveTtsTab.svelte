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

    // TTS state
    let text = $state("");
    let voice = $state("af_heart");
    let speed = $state(1.0);
    let status = $state<"idle" | "connecting" | "speaking" | "error">("idle");
    let errorMessage = $state("");

    // WebSocket and audio
    let ws: WebSocket | null = null;
    let audioContext: AudioContext | null = null;
    let nextPlayTime = 0;
    let scheduledSources: AudioBufferSourceNode[] = [];

    // Word timing state
    interface WordTiming {
        word: string;
        startMs: number;
        endMs: number;
    }
    let words = $state<
        { text: string; status: "pending" | "active" | "past" }[]
    >([]);
    let wordTimings: WordTiming[] = [];
    let audioStartTime = 0;
    let animationFrameId: number | null = null;

    onMount(() => {
        initKeycloak().then(() => {
            authInitialized = true;
        });

        const unsubscribe = onAuthStateChange((state) => {
            authState = state;
        });

        return () => {
            unsubscribe();
            cleanup();
        };
    });

    onDestroy(() => {
        cleanup();
    });

    function cleanup() {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        stopPlayback();
    }

    async function handleLogin() {
        await login("/?tab=live-tts");
    }

    async function handleLogout() {
        await logout();
    }

    function parseTextIntoWords(inputText: string) {
        const wordList = inputText.split(/\s+/).filter((w) => w.length > 0);
        words = wordList.map((w) => ({ text: w, status: "pending" as const }));
    }

    function startKaraokeLoop() {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }

        function updateKaraoke() {
            if (!audioContext || status !== "speaking") {
                return;
            }

            const currentTime =
                (audioContext.currentTime - audioStartTime) * 1000; // ms

            let wordIdx = 0;
            for (const timing of wordTimings) {
                if (wordIdx < words.length) {
                    if (currentTime >= timing.endMs) {
                        words[wordIdx].status = "past";
                    } else if (currentTime >= timing.startMs) {
                        words[wordIdx].status = "active";
                    }
                }
                wordIdx++;
            }

            // Force reactivity
            words = [...words];

            animationFrameId = requestAnimationFrame(updateKaraoke);
        }

        animationFrameId = requestAnimationFrame(updateKaraoke);
    }

    async function speak() {
        if (!authState.authenticated) {
            alert("Please log in first.");
            return;
        }

        if (!text.trim()) {
            alert("Please enter some text.");
            return;
        }

        status = "connecting";
        errorMessage = "";
        parseTextIntoWords(text);
        wordTimings = [];

        // Initialize audio context
        if (!audioContext) {
            audioContext = new AudioContext({ sampleRate: 24000 });
        }
        if (audioContext.state === "suspended") {
            await audioContext.resume();
        }
        nextPlayTime = audioContext.currentTime;
        audioStartTime = audioContext.currentTime;

        // Connect WebSocket
        const wsProtocol =
            window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${wsProtocol}//${window.location.host}/api/tts/live`;

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log("[LiveTTS] WebSocket connected");
            // Send auth message
            const token = getToken();
            ws!.send(
                JSON.stringify({ type: "auth", token: `Bearer ${token}` }),
            );
        };

        ws.onmessage = (event) => {
            if (event.data instanceof Blob) {
                // Binary audio data
                handleAudioData(event.data);
            } else {
                // JSON message
                const msg = JSON.parse(event.data);
                handleMessage(msg);
            }
        };

        ws.onerror = (event) => {
            console.error("[LiveTTS] WebSocket error:", event);
            status = "error";
            errorMessage = "WebSocket connection error";
        };

        ws.onclose = () => {
            console.log("[LiveTTS] WebSocket closed");
            if (status === "connecting") {
                status = "error";
                errorMessage = "Connection closed unexpectedly";
            }
        };
    }

    function handleMessage(msg: any) {
        switch (msg.type) {
            case "auth_ok":
                console.log("[LiveTTS] Authenticated as:", msg.username);
                status = "speaking";
                startKaraokeLoop();
                // Send synthesize request
                ws!.send(
                    JSON.stringify({
                        type: "synthesize",
                        text,
                        voice,
                        speed,
                    }),
                );
                break;

            case "auth_error":
                status = "error";
                errorMessage = msg.message;
                break;

            case "word_timing":
                // Accumulate word timings
                for (const w of msg.words) {
                    wordTimings.push({
                        word: w.word,
                        startMs: w.start_ms,
                        endMs: w.end_ms,
                    });
                }
                break;

            case "sentence_done":
                console.log("[LiveTTS] Sentence", msg.sentence_index, "done");
                break;

            case "done":
                console.log("[LiveTTS] Synthesis complete");
                // Wait for audio to finish playing
                setTimeout(() => {
                    if (status === "speaking") {
                        status = "idle";
                        // Mark all remaining words as past
                        words = words.map((w) => ({
                            ...w,
                            status: "past" as const,
                        }));
                    }
                }, 1000);
                break;

            case "error":
                status = "error";
                errorMessage = msg.message;
                break;

            case "stopped":
                status = "idle";
                break;
        }
    }

    async function handleAudioData(blob: Blob) {
        const buffer = await blob.arrayBuffer();
        const data = new DataView(buffer);

        // First 4 bytes are sentence index (u32 LE)
        // const sentenceIndex = data.getUint32(0, true);

        // Rest is PCM f32le samples
        const sampleCount = (buffer.byteLength - 4) / 4;
        const samples = new Float32Array(sampleCount);
        for (let i = 0; i < sampleCount; i++) {
            samples[i] = data.getFloat32(4 + i * 4, true);
        }

        if (!audioContext) return;

        // Create audio buffer and schedule playback
        const audioBuffer = audioContext.createBuffer(1, sampleCount, 24000);
        audioBuffer.getChannelData(0).set(samples);

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);

        // Schedule at next available time
        const startTime = Math.max(audioContext.currentTime, nextPlayTime);
        source.start(startTime);
        nextPlayTime = startTime + audioBuffer.duration;

        scheduledSources.push(source);
        source.onended = () => {
            const idx = scheduledSources.indexOf(source);
            if (idx > -1) scheduledSources.splice(idx, 1);
        };
    }

    function stop() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "stop" }));
            ws.close();
        }
        stopPlayback();
        status = "idle";
    }

    function stopPlayback() {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        for (const source of scheduledSources) {
            try {
                source.stop();
            } catch {}
        }
        scheduledSources = [];
        if (ws) {
            ws.close();
            ws = null;
        }
    }
</script>

<div class="live-tts-container">
    <div class="live-tts-card">
        <h3>Live Text-to-Speech</h3>

        {#if !authInitialized}
            <div class="auth-loading">
                <span class="spinner">...</span> Loading authentication...
            </div>
        {:else if !authState.authenticated}
            <div class="auth-required">
                <p>Please log in to use live text-to-speech.</p>
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
                <label for="live-text">Text to speak</label>
                <textarea
                    id="live-text"
                    bind:value={text}
                    placeholder="Enter text to speak..."
                    rows="4"
                    disabled={status === "speaking"}
                ></textarea>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label for="live-voice">Voice</label>
                    <select
                        id="live-voice"
                        bind:value={voice}
                        disabled={status === "speaking"}
                    >
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
                    <label for="live-speed">Speed: {speed.toFixed(1)}x</label>
                    <input
                        type="range"
                        id="live-speed"
                        bind:value={speed}
                        min="0.5"
                        max="2.0"
                        step="0.1"
                        disabled={status === "speaking"}
                    />
                </div>
            </div>

            <div class="button-row">
                {#if status === "idle" || status === "error"}
                    <button class="speak-btn" onclick={speak}>
                        🔊 Speak
                    </button>
                {:else}
                    <button class="stop-btn" onclick={stop}> ⏹ Stop </button>
                {/if}
            </div>

            {#if status === "connecting"}
                <div class="status-msg">
                    <span class="spinner">...</span> Connecting...
                </div>
            {/if}

            {#if status === "error"}
                <div class="error-msg">
                    Error: {errorMessage}
                </div>
            {/if}

            {#if words.length > 0}
                <div class="karaoke-display">
                    {#each words as word}
                        <span class="word {word.status}">{word.text}</span>
                    {/each}
                </div>
            {/if}
        {/if}
    </div>
</div>

<style>
    .live-tts-container {
        display: flex;
        justify-content: center;
    }

    .live-tts-card {
        background: #2a2a2a;
        padding: 30px;
        border-radius: 20px;
        width: 100%;
        max-width: 700px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }

    .live-tts-card h3 {
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

    textarea,
    select {
        width: 100%;
        background: #333;
        border: 1px solid #444;
        color: #fff;
        padding: 10px;
        border-radius: 8px;
        font-size: 1rem;
        box-sizing: border-box;
        resize: vertical;
    }

    textarea:disabled,
    select:disabled {
        opacity: 0.6;
    }

    input[type="range"] {
        width: 100%;
        accent-color: #4a90e2;
    }

    .button-row {
        display: flex;
        gap: 10px;
    }

    .speak-btn {
        flex: 1;
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

    .speak-btn:hover {
        background: #357abd;
    }

    .stop-btn {
        flex: 1;
        background: #f87171;
        color: white;
        border: none;
        padding: 12px;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
    }

    .stop-btn:hover {
        background: #dc2626;
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

    .error-msg {
        margin-top: 20px;
        background: rgba(248, 113, 113, 0.1);
        color: #f87171;
        padding: 15px;
        border-radius: 8px;
        text-align: center;
        border: 1px solid rgba(248, 113, 113, 0.3);
    }

    .karaoke-display {
        margin-top: 30px;
        padding: 20px;
        background: #222;
        border-radius: 12px;
        font-size: 1.4rem;
        line-height: 2;
        text-align: center;
    }

    .word {
        display: inline-block;
        padding: 2px 6px;
        margin: 2px;
        border-radius: 4px;
        transition: all 0.15s ease;
    }

    .word.pending {
        color: #666;
    }

    .word.active {
        color: #4ade80;
        background: rgba(74, 222, 128, 0.2);
        transform: scale(1.1);
        font-weight: 600;
    }

    .word.past {
        color: #aaa;
    }
</style>
