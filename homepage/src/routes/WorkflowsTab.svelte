<script lang="ts">
    import { onMount } from 'svelte';
    import { initKeycloak, login, logout, onAuthStateChange, getFreshToken, type AuthState } from '$lib/auth';

    let authState = $state<AuthState>({ authenticated: false, token: null, username: null, roles: [] });
    let authInitialized = $state(false);

    let newsSubscribed = $state(false);
    let newsLoading = $state(false);
    let newsError = $state('');

    let triggerLoading = $state(false);
    let triggerResult = $state('');
    let triggerError = $state('');

    onMount(() => {
        initKeycloak().then(() => { authInitialized = true; });
        const unsubscribe = onAuthStateChange((state) => { authState = state; });
        return () => { unsubscribe(); };
    });

    async function handleLogin() { await login('/?tab=workflows'); }
    async function handleLogout() { await logout(); }

    async function fetchSubscriptionStatus() {
        try {
            const token = await getFreshToken();
            if (!token) return;
            const res = await fetch('/api/whatsapp/news/status', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            newsSubscribed = data.subscribed || false;
        } catch (err: any) {
            console.error('[Workflows] News status fetch error:', err);
        }
    }

    async function toggleNewsSubscription() {
        newsLoading = true;
        newsError = '';
        try {
            const token = await getFreshToken();
            if (!token) return;
            const endpoint = newsSubscribed ? '/api/whatsapp/news/unsubscribe' : '/api/whatsapp/news/subscribe';
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok) {
                newsError = data.error || 'Failed to update subscription';
                return;
            }
            newsSubscribed = data.subscribed;
        } catch (err: any) {
            newsError = err.message;
        } finally {
            newsLoading = false;
        }
    }

    async function triggerNewsWorkflow() {
        triggerLoading = true;
        triggerResult = '';
        triggerError = '';
        try {
            const token = await getFreshToken();
            if (!token) return;
            const res = await fetch('/api/whatsapp/news/trigger', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok) {
                triggerError = data.error || 'Failed to trigger workflow';
                return;
            }
            triggerResult = `Workflow started: ${data.workflowId}`;
        } catch (err: any) {
            triggerError = err.message;
        } finally {
            triggerLoading = false;
        }
    }

    $effect(() => {
        if (authState.authenticated) {
            fetchSubscriptionStatus();
        }
    });
</script>

<div class="workflows-container">
    <div class="workflows-card">
        <h3>Workflows</h3>

        {#if !authInitialized}
            <div class="auth-loading">
                <span class="spinner">...</span> Loading authentication...
            </div>
        {:else if !authState.authenticated}
            <div class="auth-required">
                <p>Please log in to manage workflow subscriptions.</p>
                <button class="login-btn" onclick={handleLogin}>Log In</button>
            </div>
        {:else}
            <div class="user-info">
                <span>Logged in as: <strong>{authState.username}</strong></span>
                <button class="logout-btn" onclick={handleLogout}>Log Out</button>
            </div>

            <div class="section">
                <h4>Daily News Digest</h4>
                <p class="section-description">Get a daily AI-summarised digest of top ABC News headlines delivered to your WhatsApp at 9 AM AEST.</p>
                <div class="digest-status">
                    Status: <span class="status-badge" class:status-active={newsSubscribed} class:status-inactive={!newsSubscribed}>
                        {newsSubscribed ? 'subscribed' : 'not subscribed'}
                    </span>
                </div>
                {#if newsSubscribed}
                    <button class="unsubscribe-btn" onclick={toggleNewsSubscription} disabled={newsLoading}>
                        {#if newsLoading}
                            <span class="spinner">...</span> Updating...
                        {:else}
                            Unsubscribe
                        {/if}
                    </button>
                {:else}
                    <button class="subscribe-btn" onclick={toggleNewsSubscription} disabled={newsLoading}>
                        {#if newsLoading}
                            <span class="spinner">...</span> Updating...
                        {:else}
                            Subscribe to Daily Digest
                        {/if}
                    </button>
                {/if}
                {#if newsError}
                    <div class="error-result">{newsError}</div>
                {/if}

                <div class="trigger-section">
                    <button class="trigger-btn" onclick={triggerNewsWorkflow} disabled={triggerLoading}>
                        {#if triggerLoading}
                            <span class="spinner">...</span> Starting...
                        {:else}
                            Run Now
                        {/if}
                    </button>
                    {#if triggerResult}
                        <div class="success-result">{triggerResult}</div>
                    {/if}
                    {#if triggerError}
                        <div class="error-result">{triggerError}</div>
                    {/if}
                </div>
            </div>
        {/if}
    </div>
</div>

<style>
    .workflows-container {
        display: flex;
        justify-content: center;
    }

    .workflows-card {
        background: #2a2a2a;
        padding: 30px;
        border-radius: 20px;
        width: 100%;
        max-width: 700px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }

    .workflows-card h3 {
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

    .section-description {
        color: #999;
        font-size: 0.85rem;
        margin-bottom: 15px;
        line-height: 1.5;
    }

    .digest-status {
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

    .status-active {
        background: rgba(74, 222, 128, 0.2);
        color: #4ade80;
    }

    .status-inactive {
        background: rgba(156, 163, 175, 0.2);
        color: #9ca3af;
    }

    .subscribe-btn {
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
    }

    .subscribe-btn:hover:not(:disabled) {
        transform: scale(1.02);
        box-shadow: 0 4px 15px rgba(74, 144, 226, 0.4);
    }

    .subscribe-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
    }

    .unsubscribe-btn {
        width: 100%;
        background: transparent;
        color: #f87171;
        border: 1px solid #f87171;
        padding: 12px;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
    }

    .unsubscribe-btn:hover:not(:disabled) {
        background: #f87171;
        color: #000;
    }

    .unsubscribe-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .trigger-section {
        margin-top: 15px;
        padding-top: 15px;
        border-top: 1px solid #333;
    }

    .trigger-btn {
        width: 100%;
        background: linear-gradient(135deg, #f59e0b, #d97706);
        color: #000;
        border: none;
        padding: 10px;
        border-radius: 8px;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
    }

    .trigger-btn:hover:not(:disabled) {
        transform: scale(1.02);
        box-shadow: 0 4px 15px rgba(245, 158, 11, 0.4);
    }

    .trigger-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
    }

    .success-result {
        margin-top: 10px;
        padding: 10px;
        border-radius: 8px;
        text-align: center;
        font-size: 0.85rem;
        background: rgba(74, 222, 128, 0.1);
        color: #4ade80;
        border: 1px solid rgba(74, 222, 128, 0.3);
        word-break: break-all;
    }

    .error-result {
        margin-top: 10px;
        padding: 10px;
        border-radius: 8px;
        text-align: center;
        font-size: 0.9rem;
        background: rgba(248, 113, 113, 0.1);
        color: #f87171;
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
