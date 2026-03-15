<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { getFreshToken } from '$lib/auth';
    import { config } from '$lib/config';

    interface OcrLine {
        text: string;
        confidence: number;
        bbox: number[][];
    }

    interface OcrResult {
        id?: string;
        text: string;
        lines: OcrLine[];
        line_count: number;
        engine?: string;
    }

    interface HistoryJob {
        id: string;
        filename: string;
        engine: string;
        text_preview: string;
        line_count: number;
        created_at: string;
    }

    let selectedFile = $state<File | null>(null);
    let previewUrl = $state<string | null>(null);
    let processing = $state(false);
    let result = $state<OcrResult | null>(null);
    let error = $state('');
    let copied = $state(false);
    let dragOver = $state(false);
    let engine = $state<'paddle' | 'claude'>('paddle');

    // History state
    let showHistory = $state(false);
    let history = $state<HistoryJob[]>([]);
    let historyTotal = $state(0);
    let historyLoading = $state(false);
    let historyError = $state('');

    // Service capabilities (from /health)
    let claudeAvailable = $state(false);
    let historyAvailable = $state(false);

    onMount(async () => {
        try {
            const res = await fetch(`${config.ocr.baseUrl}/health`);
            if (res.ok) {
                const data = await res.json();
                claudeAvailable = data.claude_available ?? false;
                historyAvailable = data.history_available ?? false;
            }
        } catch { /* ignore */ }
    });

    onDestroy(() => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    });

    function handleFileSelect(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files[0]) {
            setFile(input.files[0]);
        }
    }

    function handleDrop(event: DragEvent) {
        event.preventDefault();
        dragOver = false;
        if (event.dataTransfer?.files && event.dataTransfer.files[0]) {
            setFile(event.dataTransfer.files[0]);
        }
    }

    function handleDragOver(event: DragEvent) {
        event.preventDefault();
        dragOver = true;
    }

    function handleDragLeave() {
        dragOver = false;
    }

    function setFile(file: File) {
        if (!file.type.startsWith('image/')) {
            error = 'Please select an image file';
            return;
        }
        if (file.size > 20 * 1024 * 1024) {
            error = 'File too large (max 20MB)';
            return;
        }
        selectedFile = file;
        error = '';
        result = null;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(file);
    }

    async function extractText() {
        if (!selectedFile) return;
        processing = true;
        error = '';
        result = null;

        try {
            const token = await getFreshToken();
            if (!token) {
                error = 'Not authenticated';
                return;
            }

            const formData = new FormData();
            formData.append('file', selectedFile);

            const res = await fetch(`${config.ocr.baseUrl}/api/ocr?engine=${engine}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
            });

            const data = await res.json();
            if (!res.ok) {
                error = data.detail || data.error || 'OCR failed';
                return;
            }

            result = data;
        } catch (err: any) {
            error = err.message || 'Failed to connect to OCR service';
        } finally {
            processing = false;
        }
    }

    async function copyText() {
        if (!result?.text) return;
        try {
            await navigator.clipboard.writeText(result.text);
            copied = true;
            setTimeout(() => { copied = false; }, 2000);
        } catch {
            error = 'Failed to copy to clipboard';
        }
    }

    function downloadText() {
        if (!result?.text) return;
        const blob = new Blob([result.text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ocr-${selectedFile?.name || 'result'}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function clearAll() {
        selectedFile = null;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
        result = null;
        error = '';
    }

    async function loadHistory() {
        if (!historyAvailable) return;
        showHistory = !showHistory;
        if (!showHistory) return;

        historyLoading = true;
        historyError = '';
        try {
            const token = await getFreshToken();
            if (!token) return;
            const res = await fetch(`${config.ocr.baseUrl}/api/ocr/history?limit=20`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) {
                historyError = data.detail || 'Failed to load history';
                return;
            }
            history = data.jobs;
            historyTotal = data.total;
        } catch (err: any) {
            historyError = err.message;
        } finally {
            historyLoading = false;
        }
    }

    async function loadJob(jobId: string) {
        try {
            const token = await getFreshToken();
            if (!token) return;
            const res = await fetch(`${config.ocr.baseUrl}/api/ocr/history/${jobId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) {
                error = data.detail || 'Failed to load job';
                return;
            }
            result = data;
            showHistory = false;
        } catch (err: any) {
            error = err.message;
        }
    }

    function formatDate(dateStr: string): string {
        return new Date(dateStr).toLocaleString();
    }
</script>

<div class="ocr-container">
    <div class="ocr-card">
        <h3>OCR - Text Extraction</h3>

        <!-- Engine Toggle -->
        <div class="engine-toggle">
            <button
                class="engine-btn"
                class:active={engine === 'paddle'}
                onclick={() => engine = 'paddle'}
            >
                PaddleOCR
            </button>
            <button
                class="engine-btn"
                class:active={engine === 'claude'}
                disabled={!claudeAvailable}
                onclick={() => engine = 'claude'}
                title={claudeAvailable ? 'Use Claude vision for OCR' : 'Claude not available'}
            >
                Claude
            </button>
        </div>

        <!-- Drop Zone -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="drop-zone"
            class:drag-over={dragOver}
            class:has-file={!!selectedFile}
            ondrop={handleDrop}
            ondragover={handleDragOver}
            ondragleave={handleDragLeave}
        >
            {#if previewUrl}
                <img src={previewUrl} alt="Preview" class="preview-img" />
                <div class="file-info">
                    <span class="file-name">{selectedFile?.name}</span>
                    <button class="clear-btn" onclick={clearAll}>Clear</button>
                </div>
            {:else}
                <div class="drop-prompt">
                    <span class="drop-icon">+</span>
                    <span>Drop an image here or click to select</span>
                </div>
                <input
                    type="file"
                    accept="image/*"
                    class="file-input"
                    onchange={handleFileSelect}
                />
            {/if}
        </div>

        <!-- Extract Button -->
        <button
            class="extract-btn"
            onclick={extractText}
            disabled={!selectedFile || processing}
        >
            {#if processing}
                <span class="spinner">...</span> Processing with {engine === 'claude' ? 'Claude' : 'PaddleOCR'}...
            {:else}
                Extract Text
            {/if}
        </button>

        <!-- History Toggle -->
        {#if historyAvailable}
            <button class="history-toggle-btn" onclick={loadHistory}>
                {showHistory ? 'Hide History' : 'View History'}
                {#if historyTotal > 0}
                    <span class="history-count">({historyTotal})</span>
                {/if}
            </button>
        {/if}

        <!-- Error -->
        {#if error}
            <div class="error-result">{error}</div>
        {/if}

        <!-- History -->
        {#if showHistory}
            <div class="history-section">
                <h4>Recent Extractions</h4>
                {#if historyLoading}
                    <div class="loading-indicator"><span class="spinner">...</span> Loading...</div>
                {:else if historyError}
                    <div class="error-result">{historyError}</div>
                {:else if history.length === 0}
                    <div class="empty-state">No history yet.</div>
                {:else}
                    {#each history as job (job.id)}
                        <button class="history-item" onclick={() => loadJob(job.id)}>
                            <div class="history-item-header">
                                <span class="history-filename">{job.filename}</span>
                                <span class="history-engine" class:engine-claude={job.engine === 'claude'}>
                                    {job.engine}
                                </span>
                            </div>
                            <div class="history-item-meta">
                                <span>{job.line_count} line{job.line_count !== 1 ? 's' : ''}</span>
                                <span>{formatDate(job.created_at)}</span>
                            </div>
                            {#if job.text_preview}
                                <div class="history-preview">{job.text_preview}</div>
                            {/if}
                        </button>
                    {/each}
                {/if}
            </div>
        {/if}

        <!-- Results -->
        {#if result}
            <div class="result-section">
                <div class="result-header">
                    <h4>
                        Extracted Text ({result.line_count} line{result.line_count !== 1 ? 's' : ''})
                        {#if result.engine}
                            <span class="result-engine" class:engine-claude={result.engine === 'claude'}>
                                via {result.engine}
                            </span>
                        {/if}
                    </h4>
                    <div class="result-actions">
                        <button class="action-btn" onclick={copyText}>
                            {copied ? 'Copied!' : 'Copy'}
                        </button>
                        <button class="action-btn" onclick={downloadText}>
                            Download .txt
                        </button>
                    </div>
                </div>
                <textarea class="result-text" readonly rows="10">{result.text}</textarea>

                {#if result.lines.length > 0}
                    <details class="lines-details">
                        <summary>Line details with confidence</summary>
                        <div class="lines-list">
                            {#each result.lines as line, i}
                                <div class="line-item">
                                    <span class="line-num">{i + 1}.</span>
                                    <span class="line-text">{line.text}</span>
                                    <span class="line-conf" class:high-conf={line.confidence >= 0.9} class:low-conf={line.confidence < 0.7}>
                                        {Math.round(line.confidence * 100)}%
                                    </span>
                                </div>
                            {/each}
                        </div>
                    </details>
                {/if}
            </div>
        {/if}
    </div>
</div>

<style>
    .ocr-container {
        display: flex;
        justify-content: center;
    }

    .ocr-card {
        background: #2a2a2a;
        padding: 30px;
        border-radius: 20px;
        width: 100%;
        max-width: 700px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }

    .ocr-card h3 {
        margin-top: 0;
        margin-bottom: 20px;
        text-align: center;
        color: #fff;
    }

    /* Engine Toggle */
    .engine-toggle {
        display: flex;
        background: #222;
        border-radius: 8px;
        padding: 3px;
        margin-bottom: 15px;
        gap: 3px;
    }

    .engine-btn {
        flex: 1;
        background: transparent;
        border: none;
        color: #888;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 0.85rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
    }

    .engine-btn.active {
        background: linear-gradient(135deg, #4a90e2, #357abd);
        color: #fff;
    }

    .engine-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .engine-btn:not(.active):not(:disabled):hover {
        color: #ccc;
        background: rgba(255, 255, 255, 0.05);
    }

    .drop-zone {
        position: relative;
        border: 2px dashed #444;
        border-radius: 12px;
        padding: 30px;
        text-align: center;
        transition: all 0.2s;
        cursor: pointer;
        margin-bottom: 15px;
        min-height: 120px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    }

    .drop-zone.drag-over {
        border-color: #4a90e2;
        background: rgba(74, 144, 226, 0.08);
    }

    .drop-zone.has-file {
        border-style: solid;
        border-color: #555;
        cursor: default;
    }

    .drop-prompt {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        color: #888;
    }

    .drop-icon {
        font-size: 2rem;
        color: #555;
    }

    .file-input {
        position: absolute;
        inset: 0;
        opacity: 0;
        cursor: pointer;
    }

    .preview-img {
        max-width: 100%;
        max-height: 300px;
        border-radius: 8px;
        margin-bottom: 10px;
    }

    .file-info {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .file-name {
        color: #aaa;
        font-size: 0.85rem;
    }

    .clear-btn {
        background: transparent;
        color: #f87171;
        border: 1px solid #f87171;
        padding: 3px 10px;
        border-radius: 6px;
        font-size: 0.75rem;
        cursor: pointer;
    }

    .clear-btn:hover {
        background: #f87171;
        color: #000;
    }

    .extract-btn {
        width: 100%;
        background: linear-gradient(135deg, #4a90e2, #357abd);
        color: #fff;
        border: none;
        padding: 12px;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        margin-bottom: 10px;
    }

    .extract-btn:hover:not(:disabled) {
        transform: scale(1.02);
        box-shadow: 0 4px 15px rgba(74, 144, 226, 0.4);
    }

    .extract-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .history-toggle-btn {
        width: 100%;
        background: transparent;
        color: #888;
        border: 1px solid #444;
        padding: 8px;
        border-radius: 8px;
        font-size: 0.85rem;
        cursor: pointer;
        transition: all 0.2s;
        margin-bottom: 10px;
    }

    .history-toggle-btn:hover {
        border-color: #666;
        color: #ccc;
    }

    .history-count {
        color: #666;
        font-size: 0.8rem;
    }

    .error-result {
        margin-top: 8px;
        padding: 8px;
        border-radius: 6px;
        font-size: 0.8rem;
        background: rgba(248, 113, 113, 0.1);
        color: #f87171;
        border: 1px solid rgba(248, 113, 113, 0.3);
    }

    /* History */
    .history-section {
        background: #222;
        border-radius: 12px;
        padding: 15px;
        margin-bottom: 15px;
    }

    .history-section h4 {
        margin: 0 0 12px 0;
        color: #ddd;
        font-size: 0.9rem;
    }

    .history-item {
        display: block;
        width: 100%;
        text-align: left;
        background: #2a2a2a;
        border: 1px solid #333;
        border-radius: 8px;
        padding: 10px 12px;
        margin-bottom: 8px;
        cursor: pointer;
        transition: all 0.15s;
    }

    .history-item:hover {
        border-color: #4a90e2;
        background: #2e2e3a;
    }

    .history-item-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
    }

    .history-filename {
        color: #ddd;
        font-size: 0.85rem;
        font-weight: 500;
    }

    .history-engine {
        font-size: 0.7rem;
        padding: 2px 8px;
        border-radius: 10px;
        background: rgba(74, 144, 226, 0.15);
        color: #4a90e2;
    }

    .engine-claude {
        background: rgba(168, 85, 247, 0.15);
        color: #a855f7;
    }

    .history-item-meta {
        display: flex;
        justify-content: space-between;
        color: #666;
        font-size: 0.75rem;
        margin-bottom: 4px;
    }

    .history-preview {
        color: #888;
        font-size: 0.8rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .loading-indicator {
        text-align: center;
        color: #aaa;
        padding: 15px;
    }

    .empty-state {
        text-align: center;
        color: #666;
        padding: 15px;
        font-size: 0.85rem;
    }

    /* Results */
    .result-section {
        background: #222;
        border-radius: 12px;
        padding: 20px;
        margin-top: 15px;
    }

    .result-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        flex-wrap: wrap;
        gap: 8px;
    }

    .result-header h4 {
        margin: 0;
        color: #ddd;
        font-size: 0.95rem;
    }

    .result-engine {
        font-size: 0.7rem;
        padding: 2px 8px;
        border-radius: 10px;
        background: rgba(74, 144, 226, 0.15);
        color: #4a90e2;
        margin-left: 6px;
    }

    .result-actions {
        display: flex;
        gap: 8px;
    }

    .action-btn {
        background: transparent;
        color: #4a90e2;
        border: 1px solid #4a90e2;
        padding: 5px 12px;
        border-radius: 6px;
        font-size: 0.8rem;
        cursor: pointer;
        transition: all 0.2s;
    }

    .action-btn:hover {
        background: #4a90e2;
        color: #fff;
    }

    .result-text {
        width: 100%;
        background: #333;
        border: 1px solid #444;
        border-radius: 6px;
        color: #fff;
        padding: 10px;
        font-family: inherit;
        font-size: 0.9rem;
        resize: vertical;
        box-sizing: border-box;
        line-height: 1.5;
    }

    .lines-details {
        margin-top: 12px;
    }

    .lines-details summary {
        color: #888;
        font-size: 0.85rem;
        cursor: pointer;
        padding: 6px 0;
    }

    .lines-list {
        margin-top: 8px;
    }

    .line-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 0;
        border-bottom: 1px solid #2a2a2a;
        font-size: 0.85rem;
    }

    .line-num {
        color: #555;
        min-width: 24px;
    }

    .line-text {
        flex: 1;
        color: #ccc;
    }

    .line-conf {
        color: #888;
        font-size: 0.75rem;
        min-width: 36px;
        text-align: right;
    }

    .high-conf {
        color: #4ade80;
    }

    .low-conf {
        color: #f87171;
    }

    .spinner {
        display: inline-block;
        animation: pulse 1s ease-in-out infinite;
    }

    @keyframes pulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.2); opacity: 0.7; }
    }
</style>
