<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import {
        initKeycloak,
        onAuthStateChange,
        getFreshToken,
        type AuthState,
    } from "$lib/auth";

    // Mock mode detection
    const isMockMode = import.meta.env.VITE_DEV_MODE === 'mock';

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
    let isActive = $state(false);
    let connectionStatus = $state<
        "disconnected" | "connecting" | "connected" | "error"
    >("disconnected");
    let errorMessage = $state("");

    // WebSocket and audio
    let ws: WebSocket | null = null;
    let audioContext: AudioContext | null = null;
    let nextPlayTime = 0;
    let scheduledSources: AudioBufferSourceNode[] = [];

    // Track what text has been sent
    let sentLength = 0;
    let sendDebounceTimer: ReturnType<typeof setTimeout> | null = null;

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

    // Use $effect to reactively watch text changes and send new text
    $effect(() => {
        // Access text to create reactive dependency
        const currentText = text;
        if (!isActive || !ws || ws.readyState !== WebSocket.OPEN) return;

        if (currentText.length > sentLength) {
            // Debounce: wait 500ms after last keystroke before sending
            if (sendDebounceTimer) clearTimeout(sendDebounceTimer);
            sendDebounceTimer = setTimeout(() => {
                if (!ws || ws.readyState !== WebSocket.OPEN) return;
                const newText = text.substring(sentLength);
                if (newText.length === 0) return;
                console.log("[LiveTTS] Sending new text:", newText);
                ws.send(
                    JSON.stringify({
                        type: "synthesize_append",
                        text: newText,
                        voice,
                        speed,
                    }),
                );
                sentLength = text.length;
                updateWordsDisplay();
            }, 1500);
        }
    });

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
        stopSendTimer();
        stopPlayback();
    }


    function startKaraokeLoop() {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }

        function updateKaraoke() {
            if (!audioContext || !isActive) {
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

    function updateWordsDisplay() {
        const currentText = text.trim();
        if (!currentText) {
            words = [];
            return;
        }
        const wordList = currentText
            .split(/\s+/)
            .filter((w) => w.length > 0);
        // Preserve status for existing words, add new ones as pending
        const newWords = wordList.map((w, i) => {
            if (i < words.length && words[i].text === w) {
                return words[i];
            }
            return { text: w, status: "pending" as const };
        });
        words = newWords;
    }

    function stopSendTimer() {
        if (sendDebounceTimer) {
            clearTimeout(sendDebounceTimer);
            sendDebounceTimer = null;
        }
    }

    async function toggleActive() {
        if (isActive) {
            stop();
        } else {
            await start();
        }
    }

    async function start() {
        if (!authState.authenticated) {
            alert("Please log in first.");
            return;
        }

        connectionStatus = "connecting";
        errorMessage = "";
        sentLength = 0;
        wordTimings = [];
        words = [];

        // Get a fresh token before connecting
        const token = await getFreshToken();
        if (!token) {
            connectionStatus = "error";
            errorMessage = "Failed to get authentication token";
            return;
        }

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

        // Import mock WebSocket if in mock mode
        let MockWebSocketClass: any = null;
        if (isMockMode) {
            const module = await import('$lib/mocks/websocket');
            MockWebSocketClass = module.MockLiveTTSWebSocket;
        }

        ws = isMockMode && MockWebSocketClass
            ? new MockWebSocketClass(wsUrl)
            : new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log("[LiveTTS] WebSocket connected");
            // Send auth message
            ws!.send(
                JSON.stringify({ type: "auth", token: `Bearer ${token}` }),
            );
        };

        ws.onmessage = (event) => {
            if (event.data instanceof Blob) {
                handleAudioData(event.data);
            } else {
                const msg = JSON.parse(event.data);
                console.log("[LiveTTS] Received message:", msg);
                handleMessage(msg);
            }
        };

        ws.onerror = (event) => {
            console.error("[LiveTTS] WebSocket error:", event);
            connectionStatus = "error";
            errorMessage = "WebSocket connection error";
            isActive = false;
            stopSendTimer();
        };

        ws.onclose = (event) => {
            console.log(
                `[LiveTTS] WebSocket closed: code=${event.code} reason=${event.reason}`,
            );
            if (connectionStatus === "connecting") {
                connectionStatus = "error";
                errorMessage = `Connection closed unexpectedly (code: ${event.code})`;
            } else {
                connectionStatus = "disconnected";
            }
            isActive = false;
            stopSendTimer();
        };
    }

    function handleMessage(msg: any) {
        switch (msg.type) {
            case "auth_ok":
                console.log("[LiveTTS] Authenticated as:", msg.username);
                connectionStatus = "connected";
                isActive = true;
                startKaraokeLoop();
                break;

            case "auth_error":
                connectionStatus = "error";
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
                // Synthesis of current batch complete - server is ready for more
                console.log("[LiveTTS] Synthesis batch complete");
                break;

            case "error":
                errorMessage = msg.message;
                break;

            case "stopped":
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
        stopSendTimer();
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "stop" }));
            ws.close();
        }
        stopPlayback();
        isActive = false;
        connectionStatus = "disconnected";
        sentLength = 0;
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
            <div class="feature-disabled">
                <p>Please log in using the button in the top-right corner to access live text-to-speech.</p>
            </div>
        {:else}

            <div class="form-group">
                <label for="live-text">Text to speak</label>
                <textarea
                    id="live-text"
                    bind:value={text}
                    placeholder="Start typing and your text will be spoken as you type..."
                    rows="4"
                ></textarea>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label for="live-voice">Voice</label>
                    <select
                        id="live-voice"
                        bind:value={voice}
                        disabled={isActive}
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
                        disabled={isActive}
                    />
                </div>
            </div>

            <div class="button-row">
                <button
                    class="toggle-btn"
                    class:active={isActive}
                    onclick={toggleActive}
                    disabled={connectionStatus === "connecting"}
                >
                    {#if connectionStatus === "connecting"}
                        <span class="spinner">...</span> Connecting...
                    {:else if isActive}
                        <span class="pulse-dot"></span> Active — Stop
                    {:else}
                        🔊 Start Live TTS
                    {/if}
                </button>
            </div>

            <div class="connection-status">
                Status:
                <span class="status-badge status-{connectionStatus}">
                    {connectionStatus}
                </span>
            </div>

            {#if errorMessage}
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

    .feature-disabled {
        text-align: center;
        padding: 40px 20px;
        color: #888;
        font-size: 1rem;
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
        margin-bottom: 15px;
    }

    .toggle-btn {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        background: linear-gradient(135deg, #4ade80, #22c55e);
        color: #000;
        border: none;
        padding: 15px;
        border-radius: 50px;
        font-size: 1.1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
    }

    .toggle-btn:hover:not(:disabled) {
        transform: scale(1.02);
        box-shadow: 0 4px 15px rgba(74, 222, 128, 0.4);
    }

    .toggle-btn.active {
        background: linear-gradient(135deg, #f87171, #ef4444);
        color: #fff;
    }

    .toggle-btn.active:hover:not(:disabled) {
        box-shadow: 0 4px 15px rgba(248, 113, 113, 0.4);
    }

    .toggle-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
    }

    .pulse-dot {
        width: 10px;
        height: 10px;
        background: #fff;
        border-radius: 50%;
        animation: pulse 1s ease-in-out infinite;
    }

    .connection-status {
        text-align: center;
        font-size: 0.85rem;
        color: #888;
        margin-bottom: 10px;
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

    .spinner {
        display: inline-block;
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
        margin-top: 20px;
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
