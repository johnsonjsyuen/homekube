<script lang="ts">
import { onMount } from "svelte";
import { login, logout, onAuthStateChange, type AuthState } from "$lib/auth";

let authState = $state<AuthState>({
    authenticated: false,
    token: null,
    username: null,
    roles: [],
});

function handleLogin() {
    login(window.location.href);
}

function handleLogout() {
    logout();
}

onMount(() => {
    const unsubscribe = onAuthStateChange((state) => {
        authState = state;
    });

    return unsubscribe;
});
</script>

{#if !authState.authenticated}
<div class="auth-header">
    <button class="login-btn" onclick={handleLogin}>Login</button>
</div>
{:else}
<div class="auth-header">
    <span class="username">{authState.username}</span>
    <button class="logout-btn" onclick={handleLogout}>Logout</button>
</div>
{/if}

<style>
.auth-header {
    display: flex;
    gap: 10px;
    align-items: center;
}

.username {
    font-size: 0.75rem;
    color: #aaa;
}

.login-btn {
    padding: 8px 15px;
    background: #4a90e2;
    color: white;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: background 0.2s;
}

.login-btn:hover {
    background: #357abd;
}

.logout-btn {
    padding: 8px 15px;
    background: transparent;
    color: #f87171;
    border: 1px solid #f87171;
    border-radius: 5px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: background 0.2s, color 0.2s;
}

.logout-btn:hover {
    background: #f87171;
    color: white;
}
</style>
