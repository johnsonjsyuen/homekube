<script lang="ts">
    import { onMount } from 'svelte';
    import { getFreshToken } from '$lib/auth';
    import { config } from '$lib/config';

    let newsSubscribed = $state(false);
    let newsLoading = $state(false);
    let newsError = $state('');

    let triggerLoading = $state(false);
    let triggerResult = $state('');
    let triggerError = $state('');

    let econSubscribed = $state(false);
    let econLoading = $state(false);
    let econError = $state('');
    let econTriggerLoading = $state(false);
    let econTriggerResult = $state('');
    let econTriggerError = $state('');

    onMount(() => {
        fetchSubscriptionStatus();
        fetchEconSubscriptionStatus();
    });

    async function fetchSubscriptionStatus() {
        try {
            const token = await getFreshToken();
            if (!token) return;
            const res = await fetch(`${config.workflows.baseUrl}/api/workflows/news/status`, {
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
            const endpoint = newsSubscribed
                ? `${config.workflows.baseUrl}/api/workflows/news/unsubscribe`
                : `${config.workflows.baseUrl}/api/workflows/news/subscribe`;
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
            const res = await fetch(`${config.workflows.baseUrl}/api/workflows/news/trigger`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok) {
                triggerError = data.error || 'Failed to trigger workflow';
                return;
            }
            triggerResult = `Workflow started: ${data.workflow_id}`;
        } catch (err: any) {
            triggerError = err.message;
        } finally {
            triggerLoading = false;
        }
    }

    async function fetchEconSubscriptionStatus() {
        try {
            const token = await getFreshToken();
            if (!token) return;
            const res = await fetch(`${config.workflows.baseUrl}/api/workflows/economist/status`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            econSubscribed = data.subscribed || false;
        } catch (err: any) {
            console.error('[Workflows] Economist status fetch error:', err);
        }
    }

    async function toggleEconSubscription() {
        econLoading = true;
        econError = '';
        try {
            const token = await getFreshToken();
            if (!token) return;
            const endpoint = econSubscribed
                ? `${config.workflows.baseUrl}/api/workflows/economist/unsubscribe`
                : `${config.workflows.baseUrl}/api/workflows/economist/subscribe`;
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok) {
                econError = data.error || 'Failed to update subscription';
                return;
            }
            econSubscribed = data.subscribed;
        } catch (err: any) {
            econError = err.message;
        } finally {
            econLoading = false;
        }
    }

    async function triggerEconWorkflow() {
        econTriggerLoading = true;
        econTriggerResult = '';
        econTriggerError = '';
        try {
            const token = await getFreshToken();
            if (!token) return;
            const res = await fetch(`${config.workflows.baseUrl}/api/workflows/economist/trigger`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok) {
                econTriggerError = data.error || 'Failed to trigger workflow';
                return;
            }
            econTriggerResult = `Workflow started: ${data.workflow_id}`;
        } catch (err: any) {
            econTriggerError = err.message;
        } finally {
            econTriggerLoading = false;
        }
    }

</script>

<div class="workflows-container">
    <div class="workflows-card">
        <h3>Workflows</h3>

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

            <div class="section">
                <h4>The Economist Digest</h4>
                <p class="section-description">Get a daily AI-summarised digest of top articles from The Economist delivered to your WhatsApp at 9 AM AEST.</p>
                <div class="digest-status">
                    Status: <span class="status-badge" class:status-active={econSubscribed} class:status-inactive={!econSubscribed}>
                        {econSubscribed ? 'subscribed' : 'not subscribed'}
                    </span>
                </div>
                {#if econSubscribed}
                    <button class="unsubscribe-btn" onclick={toggleEconSubscription} disabled={econLoading}>
                        {#if econLoading}
                            <span class="spinner">...</span> Updating...
                        {:else}
                            Unsubscribe
                        {/if}
                    </button>
                {:else}
                    <button class="subscribe-btn" onclick={toggleEconSubscription} disabled={econLoading}>
                        {#if econLoading}
                            <span class="spinner">...</span> Updating...
                        {:else}
                            Subscribe to Economist Digest
                        {/if}
                    </button>
                {/if}
                {#if econError}
                    <div class="error-result">{econError}</div>
                {/if}

                <div class="trigger-section">
                    <button class="trigger-btn" onclick={triggerEconWorkflow} disabled={econTriggerLoading}>
                        {#if econTriggerLoading}
                            <span class="spinner">...</span> Starting...
                        {:else}
                            Run Now
                        {/if}
                    </button>
                    {#if econTriggerResult}
                        <div class="success-result">{econTriggerResult}</div>
                    {/if}
                    {#if econTriggerError}
                        <div class="error-result">{econTriggerError}</div>
                    {/if}
                </div>
            </div>
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
