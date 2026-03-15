<script lang="ts">
    import { onDestroy } from 'svelte';
    import { getFreshToken } from '$lib/auth';
    import { config } from '$lib/config';

    interface OcrLine {
        text: string;
        confidence: number;
        bbox: number[][];
    }

    interface OcrResult {
        text: string;
        lines: OcrLine[];
        line_count: number;
    }

    let selectedFile = $state<File | null>(null);
    let previewUrl = $state<string | null>(null);
    let processing = $state(false);
    let result = $state<OcrResult | null>(null);
    let error = $state('');
    let copied = $state(false);
    let dragOver = $state(false);

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

    onDestroy(() => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    });

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
        // Create preview
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

            const res = await fetch(`${config.ocr.baseUrl}/api/ocr`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
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
</script>

<div class="ocr-container">
    <div class="ocr-card">
        <h3>OCR - Text Extraction</h3>

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
                <span class="spinner">...</span> Processing...
            {:else}
                Extract Text
            {/if}
        </button>

        <!-- Error -->
        {#if error}
            <div class="error-result">{error}</div>
        {/if}

        <!-- Results -->
        {#if result}
            <div class="result-section">
                <div class="result-header">
                    <h4>Extracted Text ({result.line_count} line{result.line_count !== 1 ? 's' : ''})</h4>
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

                <!-- Per-line details -->
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

    .error-result {
        margin-top: 8px;
        padding: 8px;
        border-radius: 6px;
        font-size: 0.8rem;
        background: rgba(248, 113, 113, 0.1);
        color: #f87171;
        border: 1px solid rgba(248, 113, 113, 0.3);
    }

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
