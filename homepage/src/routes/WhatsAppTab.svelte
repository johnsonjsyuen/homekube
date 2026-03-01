<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { getFreshToken } from '$lib/auth';

    // Registration state
    let phoneNumber = $state('');
    let pairingCode = $state('');
    let qrDataUrl = $state('');
    let linkMode = $state<'qr' | 'pairing'>('qr');
    let sessionStatus = $state<'unregistered' | 'pairing' | 'connected' | 'disconnected' | 'error'>('unregistered');
    let errorMessage = $state('');
    let whatsappJid = $state('');
    let linking = $state(false);

    // Messaging state
    let recipientPhone = $state('');
    let messageText = $state('');
    let sendResult = $state('');
    let sending = $state(false);

    // Polling
    let statusInterval: ReturnType<typeof setInterval> | null = null;
    let qrInterval: ReturnType<typeof setInterval> | null = null;

    onMount(() => {
        fetchStatus();
        return () => { cleanup(); };
    });

    onDestroy(() => { cleanup(); });

    function cleanup() {
        if (statusInterval) { clearInterval(statusInterval); statusInterval = null; }
        if (qrInterval) { clearInterval(qrInterval); qrInterval = null; }
    }

    async function fetchStatus() {
        try {
            const token = await getFreshToken();
            if (!token) return;
            const res = await fetch('/api/whatsapp/status', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            sessionStatus = data.status || 'unregistered';
            whatsappJid = data.whatsappJid || '';
            if (data.errorMessage) errorMessage = data.errorMessage;

            // Stop polling once connected or on error
            if (sessionStatus === 'connected' || sessionStatus === 'error') {
                if (statusInterval) { clearInterval(statusInterval); statusInterval = null; }
                if (qrInterval) { clearInterval(qrInterval); qrInterval = null; }
            }
        } catch (err: any) {
            console.error('[WhatsApp] Status fetch error:', err);
        }
    }

    function formatPairingCode(code: string): string {
        if (code.length === 8) return code.slice(0, 4) + '-' + code.slice(4);
        return code;
    }

    function normalizePhone(input: string): string {
        let digits = input.replace(/\D/g, '');
        if (digits.startsWith('0') && digits.length === 10) {
            digits = '61' + digits.slice(1);
        }
        return digits;
    }

    async function fetchQr() {
        try {
            const token = await getFreshToken();
            if (!token) return;
            const res = await fetch('/api/whatsapp/qr', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.qr) {
                qrDataUrl = data.qr;
            }
        } catch (err: any) {
            console.error('[WhatsApp] QR fetch error:', err);
        }
    }

    async function linkViaQr() {
        errorMessage = '';
        qrDataUrl = '';
        linking = true;
        try {
            const token = await getFreshToken();
            if (!token) return;
            const res = await fetch('/api/whatsapp/link', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok) {
                errorMessage = data.error || 'Failed to start linking';
                sessionStatus = 'error';
                return;
            }
            sessionStatus = 'pairing';
            linkMode = 'qr';

            // Poll for QR code and connection status
            qrInterval = setInterval(fetchQr, 2000);
            statusInterval = setInterval(fetchStatus, 2000);
            // Fetch first QR immediately after a short delay for baileys to connect
            setTimeout(fetchQr, 1500);
        } catch (err: any) {
            errorMessage = err.message;
            sessionStatus = 'error';
        } finally {
            linking = false;
        }
    }

    async function linkViaPairingCode() {
        if (!phoneNumber) return;
        errorMessage = '';
        pairingCode = '';
        linking = true;

        const normalized = normalizePhone(phoneNumber);
        if (normalized.length < 11) {
            errorMessage = 'Enter your full number with country code, e.g. 61412345678';
            linking = false;
            return;
        }

        try {
            const token = await getFreshToken();
            if (!token) return;
            const res = await fetch('/api/whatsapp/register', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ phoneNumber: normalized })
            });
            const data = await res.json();
            if (!res.ok) {
                errorMessage = data.error || 'Registration failed';
                sessionStatus = 'error';
                return;
            }
            pairingCode = formatPairingCode(data.pairingCode);
            sessionStatus = 'pairing';
            linkMode = 'pairing';

            statusInterval = setInterval(fetchStatus, 2000);
        } catch (err: any) {
            errorMessage = err.message;
            sessionStatus = 'error';
        } finally {
            linking = false;
        }
    }

    async function disconnect() {
        cleanup();
        try {
            const token = await getFreshToken();
            if (!token) return;
            await fetch('/api/whatsapp/disconnect', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            sessionStatus = 'disconnected';
            pairingCode = '';
            qrDataUrl = '';
            whatsappJid = '';
        } catch (err: any) {
            errorMessage = err.message;
        }
    }

    async function sendMessage() {
        if (!recipientPhone || !messageText) return;
        sending = true;
        sendResult = '';
        try {
            const token = await getFreshToken();
            if (!token) {
                sendResult = 'Error: Authentication expired, please log in again';
                return;
            }
            const res = await fetch('/api/whatsapp/send', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ recipientPhone, message: messageText })
            });
            const data = await res.json();
            if (!res.ok) {
                sendResult = `Error: ${data.error}`;
            } else {
                sendResult = `Sent! Message ID: ${data.messageId}`;
                messageText = '';
            }
        } catch (err: any) {
            sendResult = `Error: ${err.message}`;
        } finally {
            sending = false;
        }
    }

</script>

<div class="whatsapp-container">
    <div class="whatsapp-card">
        <h3>WhatsApp</h3>

        <!-- Registration Section -->
        <div class="section">
            <h4>Account Status</h4>
            <div class="connection-status">
                Status: <span class="status-badge status-{sessionStatus}">{sessionStatus}</span>
            </div>

            {#if sessionStatus === 'connected'}
                <div class="connected-info">
                    {#if whatsappJid}
                        <p>WhatsApp JID: <code>{whatsappJid}</code></p>
                    {/if}
                    <button class="disconnect-btn" onclick={disconnect}>Disconnect</button>
                </div>
            {:else if sessionStatus === 'pairing' && linkMode === 'qr'}
                <div class="pairing-info">
                    <p>Scan with WhatsApp to link your account:</p>
                    <div class="qr-container">
                        {#if qrDataUrl}
                            <img src={qrDataUrl} alt="QR Code" class="qr-image" />
                        {:else}
                            <div class="qr-placeholder">
                                <span class="spinner">...</span> Waiting for QR code...
                            </div>
                        {/if}
                    </div>
                    <ol class="pairing-steps">
                        <li>Open WhatsApp on your phone</li>
                        <li>Go to <strong>Settings &gt; Linked Devices</strong></li>
                        <li>Tap <strong>Link a Device</strong></li>
                        <li>Scan the QR code above</li>
                    </ol>
                    <div class="link-actions">
                        <button class="cancel-btn" onclick={disconnect}>Cancel</button>
                        <button class="switch-btn" onclick={() => { disconnect().then(() => { linkMode = 'pairing'; sessionStatus = 'disconnected'; }); }}>Use pairing code instead</button>
                    </div>
                </div>
            {:else if sessionStatus === 'pairing' && linkMode === 'pairing'}
                <div class="pairing-info">
                    <p>Enter this code on your phone:</p>
                    <div class="pairing-code">{pairingCode}</div>
                    <ol class="pairing-steps">
                        <li>Open WhatsApp on your phone</li>
                        <li>Go to <strong>Settings &gt; Linked Devices</strong></li>
                        <li>Tap <strong>Link a Device</strong></li>
                        <li>Tap <strong>Link with phone number instead</strong></li>
                        <li>Enter the code above</li>
                    </ol>
                    <div class="link-actions">
                        <button class="cancel-btn" onclick={disconnect}>Cancel</button>
                        <button class="switch-btn" onclick={() => { disconnect().then(() => { linkMode = 'qr'; sessionStatus = 'disconnected'; }); }}>Use QR code instead</button>
                    </div>
                </div>
            {:else}
                <div class="register-form">
                    {#if linkMode === 'qr'}
                        <button class="link-btn" onclick={linkViaQr} disabled={linking}>
                            {#if linking}
                                <span class="spinner">...</span> Starting...
                            {:else}
                                Link WhatsApp (Scan QR)
                            {/if}
                        </button>
                        <button class="switch-link" onclick={() => { linkMode = 'pairing'; }}>Use pairing code instead</button>
                    {:else}
                        <div class="form-group">
                            <label for="phone">Your WhatsApp phone number</label>
                            <input
                                id="phone"
                                type="tel"
                                bind:value={phoneNumber}
                                placeholder="e.g. 0412345678 or +61412345678"
                            />
                        </div>
                        <button class="link-btn" onclick={linkViaPairingCode} disabled={!phoneNumber || linking}>
                            {#if linking}
                                <span class="spinner">...</span> Starting...
                            {:else}
                                Link WhatsApp (Pairing Code)
                            {/if}
                        </button>
                        <button class="switch-link" onclick={() => { linkMode = 'qr'; }}>Use QR code instead</button>
                    {/if}
                </div>
            {/if}
        </div>

        <!-- Test Messaging Section (only when connected) -->
        {#if sessionStatus === 'connected'}
            <div class="section">
                <h4>Send Message</h4>
                <div class="form-group">
                    <label for="recipient">Recipient Phone</label>
                    <input
                        id="recipient"
                        type="tel"
                        bind:value={recipientPhone}
                        placeholder="61412345678"
                    />
                </div>
                <div class="form-group">
                    <label for="message">Message</label>
                    <textarea
                        id="message"
                        bind:value={messageText}
                        placeholder="Type your message..."
                        rows="3"
                    ></textarea>
                </div>
                <button class="send-btn" onclick={sendMessage} disabled={sending || !recipientPhone || !messageText}>
                    {#if sending}
                        <span class="spinner">...</span> Sending...
                    {:else}
                        Send Message
                    {/if}
                </button>
                {#if sendResult}
                    <div class="send-result" class:error={sendResult.startsWith('Error')}>
                        {sendResult}
                    </div>
                {/if}
            </div>
        {/if}

        {#if errorMessage}
            <div class="error-msg">
                Error: {errorMessage}
            </div>
        {/if}
    </div>
</div>

<style>
    .whatsapp-container {
        display: flex;
        justify-content: center;
    }

    .whatsapp-card {
        background: #2a2a2a;
        padding: 30px;
        border-radius: 20px;
        width: 100%;
        max-width: 700px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }

    .whatsapp-card h3 {
        margin-top: 0;
        margin-bottom: 20px;
        text-align: center;
        color: #fff;
    }

    .section {
        margin-top: 20px;
        padding: 20px;
        background: #222;
        border-radius: 12px;
    }

    .section h4 {
        margin-top: 0;
        margin-bottom: 15px;
        color: #ddd;
    }

    .form-group {
        margin-bottom: 15px;
    }

    label {
        display: block;
        margin-bottom: 8px;
        color: #aaa;
        font-size: 0.9rem;
    }

    input, textarea {
        width: 100%;
        background: #333;
        border: 1px solid #444;
        color: #fff;
        padding: 10px;
        border-radius: 8px;
        font-size: 1rem;
        box-sizing: border-box;
    }

    textarea {
        resize: vertical;
    }

    .connection-status {
        text-align: center;
        font-size: 0.85rem;
        color: #888;
        margin-bottom: 15px;
    }

    .status-badge {
        display: inline-block;
        padding: 2px 10px;
        border-radius: 12px;
        font-size: 0.75rem;
        font-weight: 500;
        text-transform: capitalize;
    }

    .status-unregistered {
        background: rgba(156, 163, 175, 0.2);
        color: #9ca3af;
    }

    .status-pairing {
        background: rgba(251, 191, 36, 0.2);
        color: #fbbf24;
    }

    .status-connected {
        background: rgba(74, 222, 128, 0.2);
        color: #4ade80;
    }

    .status-disconnected {
        background: rgba(156, 163, 175, 0.2);
        color: #9ca3af;
    }

    .status-error {
        background: rgba(248, 113, 113, 0.2);
        color: #f87171;
    }

    .pairing-info {
        text-align: center;
    }

    .pairing-info p {
        color: #aaa;
        margin-bottom: 10px;
    }

    .pairing-code {
        font-size: 2.5rem;
        font-weight: 700;
        letter-spacing: 0.3em;
        color: #4ade80;
        text-align: center;
        padding: 20px;
        background: #1a1a1a;
        border-radius: 12px;
        margin: 15px 0;
        font-family: monospace;
    }

    .qr-container {
        display: flex;
        justify-content: center;
        margin: 15px 0;
    }

    .qr-image {
        border-radius: 12px;
        width: 300px;
        height: 300px;
    }

    .qr-placeholder {
        width: 300px;
        height: 300px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #1a1a1a;
        border-radius: 12px;
        color: #666;
        font-size: 0.9rem;
    }

    .link-actions {
        display: flex;
        gap: 10px;
        justify-content: center;
        margin-top: 15px;
    }

    .switch-btn {
        background: transparent;
        color: #4a90e2;
        border: 1px solid #4a90e2;
        padding: 8px 20px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.9rem;
        transition: all 0.2s;
    }

    .switch-btn:hover {
        background: #4a90e2;
        color: #fff;
    }

    .switch-link {
        display: block;
        margin: 10px auto 0;
        background: none;
        border: none;
        color: #4a90e2;
        cursor: pointer;
        font-size: 0.85rem;
        text-decoration: underline;
    }

    .switch-link:hover {
        color: #357abd;
    }

    .pairing-steps {
        text-align: left;
        font-size: 0.85rem;
        color: #999;
        margin: 15px auto;
        max-width: 400px;
        padding-left: 20px;
        line-height: 1.8;
    }

    .pairing-steps strong {
        color: #ccc;
    }

    .connected-info {
        text-align: center;
    }

    .connected-info p {
        color: #aaa;
        margin-bottom: 10px;
    }

    .connected-info code {
        background: #333;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 0.85rem;
    }

    .link-btn, .send-btn {
        width: 100%;
        background: linear-gradient(135deg, #25D366, #128C7E);
        color: #fff;
        border: none;
        padding: 12px;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
    }

    .link-btn:hover:not(:disabled), .send-btn:hover:not(:disabled) {
        transform: scale(1.02);
        box-shadow: 0 4px 15px rgba(37, 211, 102, 0.4);
    }

    .link-btn:disabled, .send-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
    }

    .cancel-btn {
        margin-top: 15px;
        background: transparent;
        color: #9ca3af;
        border: 1px solid #9ca3af;
        padding: 8px 20px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.9rem;
        transition: all 0.2s;
    }

    .cancel-btn:hover {
        background: #9ca3af;
        color: #000;
    }

    .disconnect-btn {
        background: transparent;
        color: #f87171;
        border: 1px solid #f87171;
        padding: 8px 20px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.9rem;
        transition: all 0.2s;
    }

    .disconnect-btn:hover {
        background: #f87171;
        color: #000;
    }

    .send-result {
        margin-top: 10px;
        padding: 10px;
        border-radius: 8px;
        text-align: center;
        font-size: 0.9rem;
        background: rgba(74, 222, 128, 0.1);
        color: #4ade80;
        border: 1px solid rgba(74, 222, 128, 0.3);
    }

    .send-result.error {
        background: rgba(248, 113, 113, 0.1);
        color: #f87171;
        border: 1px solid rgba(248, 113, 113, 0.3);
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

    @keyframes pulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.2); opacity: 0.7; }
    }

</style>
