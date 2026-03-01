<script lang="ts">
    import { onMount } from 'svelte';
    import { getFreshToken } from '$lib/auth';

    interface Job {
        id: string;
        user_id: string;
        name: string;
        urls: string[];
        instruction: string;
        schedule_cron: string;
        timezone: string;
        enabled: boolean;
        created_at: string;
        updated_at: string;
    }

    interface Run {
        id: string;
        job_id: string;
        status: 'running' | 'success' | 'failure';
        urls_scraped: number;
        notified: boolean;
        claude_response: string | null;
        error: string | null;
        started_at: string;
        completed_at: string | null;
    }

    let jobs = $state<Job[]>([]);
    let jobsLoading = $state(false);
    let jobsError = $state('');

    // Create form state
    let showCreateForm = $state(false);
    let createName = $state('');
    let createUrls = $state('');
    let createInstruction = $state('');
    let createCron = $state('0 */3 * * *');
    let createTimezone = $state('Australia/Sydney');
    let createLoading = $state(false);
    let createError = $state('');

    // Edit form state
    let editingJob = $state<Job | null>(null);
    let editName = $state('');
    let editUrls = $state('');
    let editInstruction = $state('');
    let editCron = $state('');
    let editTimezone = $state('');
    let editLoading = $state(false);
    let editError = $state('');

    // Run history state
    let expandedJobId = $state<string | null>(null);
    let runs = $state<Record<string, Run[]>>({});
    let runsLoading = $state<Record<string, boolean>>({});

    // Trigger state
    let triggerLoading = $state<Record<string, boolean>>({});
    let triggerResult = $state<Record<string, string>>({});

    onMount(() => {
        fetchJobs();
    });

    async function fetchJobs() {
        jobsLoading = true;
        jobsError = '';
        try {
            const token = await getFreshToken();
            if (!token) return;
            const res = await fetch('/api/scraper/jobs', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok) {
                jobsError = data.error || 'Failed to load jobs';
                return;
            }
            jobs = data.jobs || [];
        } catch (err: any) {
            jobsError = err.message;
        } finally {
            jobsLoading = false;
        }
    }

    async function createJob() {
        createLoading = true;
        createError = '';
        try {
            const token = await getFreshToken();
            if (!token) return;
            const urlList = createUrls.split(/[,\n]+/).map(u => u.trim()).filter(Boolean);
            if (urlList.length === 0) {
                createError = 'At least one URL is required';
                return;
            }
            const res = await fetch('/api/scraper/jobs', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: createName,
                    urls: urlList,
                    instruction: createInstruction,
                    schedule_cron: createCron,
                    timezone: createTimezone,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                createError = data.error || 'Failed to create job';
                return;
            }
            // Reset form and refresh
            createName = '';
            createUrls = '';
            createInstruction = '';
            createCron = '0 */3 * * *';
            createTimezone = 'Australia/Sydney';
            showCreateForm = false;
            await fetchJobs();
        } catch (err: any) {
            createError = err.message;
        } finally {
            createLoading = false;
        }
    }

    function startEdit(job: Job) {
        editingJob = job;
        editName = job.name;
        editUrls = job.urls.join('\n');
        editInstruction = job.instruction;
        editCron = job.schedule_cron;
        editTimezone = job.timezone;
        editError = '';
    }

    function cancelEdit() {
        editingJob = null;
        editError = '';
    }

    async function saveEdit() {
        if (!editingJob) return;
        editLoading = true;
        editError = '';
        try {
            const token = await getFreshToken();
            if (!token) return;
            const urlList = editUrls.split(/[,\n]+/).map(u => u.trim()).filter(Boolean);
            const res = await fetch(`/api/scraper/jobs/${editingJob.id}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: editName,
                    urls: urlList,
                    instruction: editInstruction,
                    schedule_cron: editCron,
                    timezone: editTimezone,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                editError = data.error || 'Failed to update job';
                return;
            }
            editingJob = null;
            await fetchJobs();
        } catch (err: any) {
            editError = err.message;
        } finally {
            editLoading = false;
        }
    }

    async function toggleEnabled(job: Job) {
        try {
            const token = await getFreshToken();
            if (!token) return;
            const res = await fetch(`/api/scraper/jobs/${job.id}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ enabled: !job.enabled }),
            });
            if (res.ok) {
                await fetchJobs();
            }
        } catch (err: any) {
            console.error('[Scraper] Toggle enabled error:', err);
        }
    }

    async function deleteJob(job: Job) {
        if (!confirm(`Delete "${job.name}"? This cannot be undone.`)) return;
        try {
            const token = await getFreshToken();
            if (!token) return;
            const res = await fetch(`/api/scraper/jobs/${job.id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (res.ok) {
                await fetchJobs();
            }
        } catch (err: any) {
            console.error('[Scraper] Delete error:', err);
        }
    }

    async function triggerJob(job: Job) {
        triggerLoading = { ...triggerLoading, [job.id]: true };
        triggerResult = { ...triggerResult, [job.id]: '' };
        try {
            const token = await getFreshToken();
            if (!token) return;
            const res = await fetch(`/api/scraper/jobs/${job.id}/trigger`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) {
                triggerResult = { ...triggerResult, [job.id]: `Error: ${data.error}` };
                return;
            }
            triggerResult = { ...triggerResult, [job.id]: `Started: ${data.workflow_id}` };
        } catch (err: any) {
            triggerResult = { ...triggerResult, [job.id]: `Error: ${err.message}` };
        } finally {
            triggerLoading = { ...triggerLoading, [job.id]: false };
        }
    }

    async function toggleRuns(jobId: string) {
        if (expandedJobId === jobId) {
            expandedJobId = null;
            return;
        }
        expandedJobId = jobId;
        runsLoading = { ...runsLoading, [jobId]: true };
        try {
            const token = await getFreshToken();
            if (!token) return;
            const res = await fetch(`/api/scraper/jobs/${jobId}/runs?limit=10`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (res.ok) {
                runs = { ...runs, [jobId]: data.runs || [] };
            }
        } catch (err: any) {
            console.error('[Scraper] Fetch runs error:', err);
        } finally {
            runsLoading = { ...runsLoading, [jobId]: false };
        }
    }

    function describeCron(cron: string): string {
        const parts = cron.trim().split(/\s+/);
        if (parts.length !== 5) return cron;
        const [min, hour] = parts;
        if (hour.startsWith('*/')) {
            const interval = hour.slice(2);
            return `Every ${interval} hour(s)`;
        }
        if (hour !== '*' && min !== '*') {
            return `Daily at ${hour}:${min.padStart(2, '0')}`;
        }
        return cron;
    }

    function formatDate(dateStr: string): string {
        return new Date(dateStr).toLocaleString();
    }

</script>

<div class="scraper-container">
    <div class="scraper-card">
        <h3>Web Scraper</h3>

        <!-- Create Job Button -->
        <div class="create-section">
            <button class="create-btn" onclick={() => showCreateForm = !showCreateForm}>
                {showCreateForm ? 'Cancel' : '+ New Job'}
            </button>
        </div>

        <!-- Create Job Form -->
        {#if showCreateForm}
            <div class="form-section">
                <h4>Create New Job</h4>
                <label class="form-label">
                    Name
                    <input type="text" class="form-input" bind:value={createName} placeholder="e.g. Concert Tickets" />
                </label>
                <label class="form-label">
                    URLs (one per line or comma-separated)
                    <textarea class="form-textarea" bind:value={createUrls} placeholder="https://example.com/events" rows="3"></textarea>
                </label>
                <label class="form-label">
                    Instruction
                    <textarea class="form-textarea" bind:value={createInstruction} placeholder="e.g. Notify me if Tool or Puscifer tickets announced" rows="2"></textarea>
                </label>
                <div class="form-row">
                    <label class="form-label form-half">
                        Schedule (cron)
                        <input type="text" class="form-input" bind:value={createCron} />
                        <span class="form-hint">{describeCron(createCron)}</span>
                    </label>
                    <label class="form-label form-half">
                        Timezone
                        <select class="form-select" bind:value={createTimezone}>
                            <option value="Australia/Sydney">Australia/Sydney</option>
                            <option value="Australia/Melbourne">Australia/Melbourne</option>
                            <option value="Australia/Brisbane">Australia/Brisbane</option>
                            <option value="Asia/Hong_Kong">Asia/Hong Kong</option>
                            <option value="UTC">UTC</option>
                        </select>
                    </label>
                </div>
                <button class="submit-btn" onclick={createJob} disabled={createLoading || !createName || !createUrls || !createInstruction}>
                    {#if createLoading}
                        <span class="spinner">...</span> Creating...
                    {:else}
                        Create Job
                    {/if}
                </button>
                {#if createError}
                    <div class="error-result">{createError}</div>
                {/if}
            </div>
        {/if}

        <!-- Edit Job Form -->
        {#if editingJob}
            <div class="form-section">
                <h4>Edit: {editingJob.name}</h4>
                <label class="form-label">
                    Name
                    <input type="text" class="form-input" bind:value={editName} />
                </label>
                <label class="form-label">
                    URLs (one per line or comma-separated)
                    <textarea class="form-textarea" bind:value={editUrls} rows="3"></textarea>
                </label>
                <label class="form-label">
                    Instruction
                    <textarea class="form-textarea" bind:value={editInstruction} rows="2"></textarea>
                </label>
                <div class="form-row">
                    <label class="form-label form-half">
                        Schedule (cron)
                        <input type="text" class="form-input" bind:value={editCron} />
                        <span class="form-hint">{describeCron(editCron)}</span>
                    </label>
                    <label class="form-label form-half">
                        Timezone
                        <select class="form-select" bind:value={editTimezone}>
                            <option value="Australia/Sydney">Australia/Sydney</option>
                            <option value="Australia/Melbourne">Australia/Melbourne</option>
                            <option value="Australia/Brisbane">Australia/Brisbane</option>
                            <option value="Asia/Hong_Kong">Asia/Hong Kong</option>
                            <option value="UTC">UTC</option>
                        </select>
                    </label>
                </div>
                <div class="form-actions">
                    <button class="submit-btn" onclick={saveEdit} disabled={editLoading}>
                        {#if editLoading}
                            <span class="spinner">...</span> Saving...
                        {:else}
                            Save Changes
                        {/if}
                    </button>
                    <button class="cancel-btn" onclick={cancelEdit}>Cancel</button>
                </div>
                {#if editError}
                    <div class="error-result">{editError}</div>
                {/if}
            </div>
        {/if}

        <!-- Jobs List -->
        {#if jobsLoading}
            <div class="loading-indicator">
                <span class="spinner">...</span> Loading jobs...
            </div>
        {:else if jobsError}
            <div class="error-result">{jobsError}</div>
        {:else if jobs.length === 0}
            <div class="empty-state">No scraper jobs yet. Create one to get started.</div>
        {:else}
            {#each jobs as job (job.id)}
                <div class="job-card">
                    <div class="job-header">
                        <div class="job-title">
                            <strong>{job.name}</strong>
                            <span class="job-meta">{job.urls.length} URL{job.urls.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div class="job-actions">
                            <button
                                class="toggle-btn"
                                class:toggle-on={job.enabled}
                                class:toggle-off={!job.enabled}
                                onclick={() => toggleEnabled(job)}
                                title={job.enabled ? 'Disable' : 'Enable'}
                            >
                                {job.enabled ? 'ON' : 'OFF'}
                            </button>
                        </div>
                    </div>

                    <div class="job-details">
                        <span class="job-schedule">{describeCron(job.schedule_cron)} ({job.timezone})</span>
                    </div>
                    <div class="job-instruction">{job.instruction}</div>

                    <div class="job-buttons">
                        <button class="trigger-btn" onclick={() => triggerJob(job)} disabled={triggerLoading[job.id]}>
                            {#if triggerLoading[job.id]}
                                <span class="spinner">...</span>
                            {:else}
                                Run Now
                            {/if}
                        </button>
                        <button class="edit-btn" onclick={() => startEdit(job)}>Edit</button>
                        <button class="history-btn" onclick={() => toggleRuns(job.id)}>
                            {expandedJobId === job.id ? 'Hide History' : 'History'}
                        </button>
                        <button class="delete-btn" onclick={() => deleteJob(job)}>Delete</button>
                    </div>

                    {#if triggerResult[job.id]}
                        <div class="success-result">{triggerResult[job.id]}</div>
                    {/if}

                    <!-- Run History -->
                    {#if expandedJobId === job.id}
                        <div class="runs-section">
                            {#if runsLoading[job.id]}
                                <div class="loading-indicator"><span class="spinner">...</span> Loading...</div>
                            {:else if (runs[job.id] || []).length === 0}
                                <div class="empty-state">No runs yet.</div>
                            {:else}
                                <table class="runs-table">
                                    <thead>
                                        <tr>
                                            <th>Status</th>
                                            <th>URLs</th>
                                            <th>Notified</th>
                                            <th>Started</th>
                                            <th>Response</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {#each runs[job.id] as run (run.id)}
                                            <tr>
                                                <td>
                                                    <span class="status-badge"
                                                        class:status-success={run.status === 'success'}
                                                        class:status-failure={run.status === 'failure'}
                                                        class:status-running={run.status === 'running'}
                                                    >
                                                        {run.status}
                                                    </span>
                                                </td>
                                                <td>{run.urls_scraped}</td>
                                                <td>{run.notified ? 'Yes' : 'No'}</td>
                                                <td>{formatDate(run.started_at)}</td>
                                                <td class="run-response">{run.error || run.claude_response || '—'}</td>
                                            </tr>
                                        {/each}
                                    </tbody>
                                </table>
                            {/if}
                        </div>
                    {/if}
                </div>
            {/each}
        {/if}
    </div>
</div>

<style>
    .scraper-container {
        display: flex;
        justify-content: center;
    }

    .scraper-card {
        background: #2a2a2a;
        padding: 30px;
        border-radius: 20px;
        width: 100%;
        max-width: 700px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }

    .scraper-card h3 {
        margin-top: 0;
        margin-bottom: 20px;
        text-align: center;
        color: #fff;
    }

    .loading-indicator {
        text-align: center;
        color: #aaa;
        padding: 20px;
    }

    .create-section {
        margin-bottom: 15px;
    }

    .create-btn {
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

    .create-btn:hover {
        transform: scale(1.02);
        box-shadow: 0 4px 15px rgba(74, 144, 226, 0.4);
    }

    .form-section {
        background: #222;
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 15px;
    }

    .form-section h4 {
        margin-top: 0;
        margin-bottom: 15px;
        color: #ddd;
    }

    .form-label {
        display: block;
        color: #aaa;
        font-size: 0.85rem;
        margin-bottom: 12px;
    }

    .form-input, .form-textarea, .form-select {
        display: block;
        width: 100%;
        margin-top: 4px;
        padding: 8px 10px;
        background: #333;
        border: 1px solid #444;
        border-radius: 6px;
        color: #fff;
        font-size: 0.9rem;
        font-family: inherit;
        box-sizing: border-box;
    }

    .form-textarea {
        resize: vertical;
    }

    .form-row {
        display: flex;
        gap: 12px;
    }

    .form-half {
        flex: 1;
    }

    .form-hint {
        display: block;
        color: #666;
        font-size: 0.75rem;
        margin-top: 2px;
    }

    .form-actions {
        display: flex;
        gap: 10px;
    }

    .submit-btn {
        flex: 1;
        background: linear-gradient(135deg, #4a90e2, #357abd);
        color: #fff;
        border: none;
        padding: 10px;
        border-radius: 8px;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
    }

    .submit-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .cancel-btn {
        background: transparent;
        color: #aaa;
        border: 1px solid #555;
        padding: 10px 20px;
        border-radius: 8px;
        font-size: 0.9rem;
        cursor: pointer;
    }

    .cancel-btn:hover {
        border-color: #aaa;
        color: #fff;
    }

    .empty-state {
        text-align: center;
        color: #666;
        padding: 20px;
        font-size: 0.9rem;
    }

    .job-card {
        background: #222;
        border-radius: 12px;
        padding: 15px;
        margin-bottom: 12px;
    }

    .job-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
    }

    .job-title {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .job-title strong {
        color: #fff;
    }

    .job-meta {
        color: #666;
        font-size: 0.8rem;
    }

    .job-details {
        margin-bottom: 6px;
    }

    .job-schedule {
        color: #888;
        font-size: 0.8rem;
    }

    .job-instruction {
        color: #999;
        font-size: 0.85rem;
        margin-bottom: 10px;
        line-height: 1.4;
    }

    .job-buttons {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }

    .toggle-btn {
        padding: 3px 10px;
        border-radius: 12px;
        font-size: 0.75rem;
        font-weight: 600;
        border: none;
        cursor: pointer;
    }

    .toggle-on {
        background: rgba(74, 222, 128, 0.2);
        color: #4ade80;
    }

    .toggle-off {
        background: rgba(156, 163, 175, 0.2);
        color: #9ca3af;
    }

    .trigger-btn {
        background: linear-gradient(135deg, #f59e0b, #d97706);
        color: #000;
        border: none;
        padding: 6px 14px;
        border-radius: 6px;
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
    }

    .trigger-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .edit-btn {
        background: transparent;
        color: #4a90e2;
        border: 1px solid #4a90e2;
        padding: 6px 14px;
        border-radius: 6px;
        font-size: 0.8rem;
        cursor: pointer;
    }

    .edit-btn:hover {
        background: #4a90e2;
        color: #fff;
    }

    .history-btn {
        background: transparent;
        color: #aaa;
        border: 1px solid #555;
        padding: 6px 14px;
        border-radius: 6px;
        font-size: 0.8rem;
        cursor: pointer;
    }

    .history-btn:hover {
        border-color: #aaa;
        color: #fff;
    }

    .delete-btn {
        background: transparent;
        color: #f87171;
        border: 1px solid #f87171;
        padding: 6px 14px;
        border-radius: 6px;
        font-size: 0.8rem;
        cursor: pointer;
    }

    .delete-btn:hover {
        background: #f87171;
        color: #000;
    }

    .runs-section {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid #333;
    }

    .runs-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.8rem;
    }

    .runs-table th {
        text-align: left;
        color: #888;
        font-weight: 500;
        padding: 4px 8px;
        border-bottom: 1px solid #333;
    }

    .runs-table td {
        padding: 6px 8px;
        color: #ccc;
        border-bottom: 1px solid #2a2a2a;
    }

    .run-response {
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .status-badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 0.7rem;
        font-weight: 500;
    }

    .status-success {
        background: rgba(74, 222, 128, 0.2);
        color: #4ade80;
    }

    .status-failure {
        background: rgba(248, 113, 113, 0.2);
        color: #f87171;
    }

    .status-running {
        background: rgba(245, 158, 11, 0.2);
        color: #f59e0b;
    }

    .success-result {
        margin-top: 8px;
        padding: 8px;
        border-radius: 6px;
        font-size: 0.8rem;
        background: rgba(74, 222, 128, 0.1);
        color: #4ade80;
        border: 1px solid rgba(74, 222, 128, 0.3);
        word-break: break-all;
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

    .spinner {
        display: inline-block;
        animation: pulse 1s ease-in-out infinite;
    }

    @keyframes pulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.2); opacity: 0.7; }
    }
</style>
