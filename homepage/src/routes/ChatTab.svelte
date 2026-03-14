<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { getFreshToken } from "$lib/auth";
    import { config } from "$lib/config";

    // Types
    interface Conversation {
        id: string;
        title: string;
        updated_at: string;
    }

    interface Message {
        id: string;
        role: "user" | "assistant";
        content: string;
        created_at: string;
    }

    // State
    let ws = $state<WebSocket | null>(null);
    let connected = $state(false);
    let conversations = $state<Conversation[]>([]);
    let activeConversationId = $state<string | null>(null);
    let messages = $state<Message[]>([]);
    let inputText = $state("");
    let streaming = $state(false);
    let streamBuffer = $state("");
    let errorMessage = $state("");
    let sidebarOpen = $state(true);
    let deleteConfirmId = $state<string | null>(null);

    // Reconnect state
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let intentionalClose = false;

    // DOM refs
    let messagesContainer = $state<HTMLDivElement>(undefined!);

    // Derived
    let activeConversation = $derived(
        conversations.find((c) => c.id === activeConversationId) ?? null,
    );

    // Auto-scroll on new messages or stream updates
    $effect(() => {
        // Track dependencies that should trigger scroll
        const _msgs = messages.length;
        const _buf = streamBuffer;
        scrollToBottom();
    });

    onMount(() => {
        connectWebSocket();
    });

    onDestroy(() => {
        intentionalClose = true;
        clearReconnectTimer();
        if (ws) {
            ws.close();
            ws = null;
        }
    });

    function clearReconnectTimer() {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    }

    function scheduleReconnect() {
        if (intentionalClose) return;
        clearReconnectTimer();
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 30000);
        console.log(
            `[Chat] Reconnecting in ${delay}ms (attempt ${reconnectAttempt + 1})`,
        );
        reconnectTimer = setTimeout(() => {
            reconnectAttempt++;
            connectWebSocket();
        }, delay);
    }

    async function connectWebSocket() {
        const token = await getFreshToken();
        if (!token) {
            errorMessage = "No authentication token available";
            return;
        }

        try {
            const wsUrl = config.claudeChat.wsUrl;
            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                console.log("[Chat] WebSocket connected, sending auth");
                ws!.send(
                    JSON.stringify({ type: "auth", token: `Bearer ${token}` }),
                );
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    handleServerMessage(msg);
                } catch (e) {
                    console.error("[Chat] Failed to parse message:", e);
                }
            };

            ws.onerror = (error) => {
                console.error("[Chat] WebSocket error:", error);
            };

            ws.onclose = () => {
                console.log("[Chat] WebSocket closed");
                ws = null;
                connected = false;
                if (!intentionalClose) {
                    scheduleReconnect();
                }
            };
        } catch (e: any) {
            console.error("[Chat] Failed to connect:", e);
            errorMessage = e.message;
            scheduleReconnect();
        }
    }

    function handleServerMessage(msg: any) {
        switch (msg.type) {
            case "auth_ok":
                console.log("[Chat] Authenticated as:", msg.username);
                connected = true;
                reconnectAttempt = 0;
                errorMessage = "";
                sendWs({ type: "list_conversations" });
                break;

            case "auth_error":
                errorMessage = msg.message || "Authentication failed";
                connected = false;
                break;

            case "conversations":
                conversations = msg.data ?? [];
                break;

            case "conversation_created":
                conversations = [
                    {
                        id: msg.id,
                        title: msg.title,
                        updated_at: new Date().toISOString(),
                    },
                    ...conversations,
                ];
                activeConversationId = msg.id;
                messages = [];
                streamBuffer = "";
                sendWs({
                    type: "load_conversation",
                    id: msg.id,
                });
                break;

            case "conversation_loaded":
                activeConversationId = msg.id;
                messages = msg.messages ?? [];
                streamBuffer = "";
                streaming = false;
                break;

            case "stream_text":
                streamBuffer += msg.text;
                break;

            case "message_complete": {
                if (streamBuffer) {
                    const assistantMsg: Message = {
                        id: crypto.randomUUID(),
                        role: "assistant",
                        content: streamBuffer,
                        created_at: new Date().toISOString(),
                    };
                    messages = [...messages, assistantMsg];
                }
                streamBuffer = "";
                streaming = false;
                // Refresh conversation list to update timestamps/titles
                sendWs({ type: "list_conversations" });
                break;
            }

            case "conversation_deleted":
                conversations = conversations.filter(
                    (c) => c.id !== msg.id,
                );
                if (activeConversationId === msg.id) {
                    activeConversationId = null;
                    messages = [];
                }
                deleteConfirmId = null;
                break;

            case "error":
                errorMessage = msg.message || "An error occurred";
                streaming = false;
                break;

            default:
                console.log("[Chat] Unknown message type:", msg.type);
        }
    }

    function sendWs(data: Record<string, unknown>) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    function scrollToBottom() {
        requestAnimationFrame(() => {
            if (messagesContainer) {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        });
    }

    // UI actions
    function createConversation() {
        sendWs({ type: "create_conversation" });
    }

    function selectConversation(id: string) {
        if (id === activeConversationId) return;
        activeConversationId = id;
        messages = [];
        streamBuffer = "";
        streaming = false;
        sendWs({ type: "load_conversation", id });
        // Auto-close sidebar on mobile after selecting a conversation
        if (window.matchMedia('(max-width: 768px)').matches) {
            sidebarOpen = false;
        }
    }

    function deleteConversation(id: string) {
        if (deleteConfirmId === id) {
            sendWs({ type: "delete_conversation", id });
            deleteConfirmId = null;
        } else {
            deleteConfirmId = id;
            // Auto-clear confirm after 3 seconds
            setTimeout(() => {
                if (deleteConfirmId === id) deleteConfirmId = null;
            }, 3000);
        }
    }

    function sendMessage() {
        const content = inputText.trim();
        if (!content || !activeConversationId || streaming) return;

        // Add user message to UI immediately
        const userMsg: Message = {
            id: crypto.randomUUID(),
            role: "user",
            content,
            created_at: new Date().toISOString(),
        };
        messages = [...messages, userMsg];
        inputText = "";
        streaming = true;
        streamBuffer = "";

        sendWs({
            type: "send_message",
            conversation_id: activeConversationId,
            content,
        });
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    }

    function formatTime(dateStr: string): string {
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
            });
        } catch {
            return "";
        }
    }

    function formatRelativeTime(dateStr: string): string {
        try {
            const now = Date.now();
            const then = new Date(dateStr).getTime();
            const diffMs = now - then;

            if (diffMs < 0) return "just now";

            const seconds = Math.floor(diffMs / 1000);
            if (seconds < 60) return "just now";

            const minutes = Math.floor(seconds / 60);
            if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;

            const hours = Math.floor(minutes / 60);
            if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;

            const days = Math.floor(hours / 24);
            if (days < 30) return days === 1 ? "1 day ago" : `${days} days ago`;

            const months = Math.floor(days / 30);
            if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`;

            const years = Math.floor(months / 12);
            return years === 1 ? "1 year ago" : `${years} years ago`;
        } catch {
            return "";
        }
    }
</script>

<div class="chat-container">
    <!-- Mobile header bar -->
    <header class="mobile-header">
        <button
            class="header-menu-btn"
            onclick={() => (sidebarOpen = !sidebarOpen)}
            aria-label="Toggle sidebar"
        >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
        </button>
        <span class="header-title">
            {activeConversation ? activeConversation.title : "Claude Chat"}
        </span>
        <button
            class="header-new-btn"
            onclick={createConversation}
            disabled={!connected}
            aria-label="New conversation"
        >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
        </button>
    </header>

    <!-- Mobile backdrop overlay -->
    {#if sidebarOpen}
        <button
            class="sidebar-backdrop"
            onclick={() => (sidebarOpen = false)}
            aria-label="Close sidebar"
            tabindex="-1"
        ></button>
    {/if}

    <!-- Sidebar -->
    <aside class="sidebar" class:open={sidebarOpen}>
        <button class="new-chat-btn" onclick={createConversation} disabled={!connected}>
            + New Chat
        </button>

        <div class="conversation-list">
            {#each conversations as conv (conv.id)}
                <div
                    class="conversation-item"
                    class:active={conv.id === activeConversationId}
                >
                    <button
                        class="conversation-btn"
                        onclick={() => selectConversation(conv.id)}
                        title={conv.title}
                    >
                        <span class="conv-title">{conv.title}</span>
                        <span class="conv-date">{formatTime(conv.updated_at)}</span>
                    </button>
                    <button
                        class="delete-btn"
                        class:confirm={deleteConfirmId === conv.id}
                        onclick={(e) => {
                            e.stopPropagation();
                            deleteConversation(conv.id);
                        }}
                        title={deleteConfirmId === conv.id ? "Click again to confirm" : "Delete conversation"}
                    >
                        {deleteConfirmId === conv.id ? "?" : "\u00d7"}
                    </button>
                </div>
            {/each}

            {#if conversations.length === 0 && connected}
                <div class="no-conversations">No conversations yet</div>
            {/if}
        </div>

        <div class="connection-badge" class:connected>
            <span class="status-dot"></span>
            {connected ? "Connected" : "Disconnected"}
        </div>
    </aside>

    <!-- Main chat area -->
    <main class="chat-main">
        {#if !activeConversationId}
            <div class="welcome-screen">
                <div class="welcome-content">
                    <div class="welcome-header">
                        <div class="welcome-icon">
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                        </div>
                        <h2 class="welcome-title">Claude Chat</h2>
                    </div>

                    <button
                        class="welcome-new-btn"
                        onclick={createConversation}
                        disabled={!connected}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        New Conversation
                    </button>

                    {#if conversations.length > 0}
                        <div class="recent-section">
                            <h3 class="recent-heading">Resume a conversation</h3>
                            <div class="recent-list">
                                {#each conversations as conv (conv.id)}
                                    <button
                                        class="recent-card"
                                        onclick={() => selectConversation(conv.id)}
                                    >
                                        <span class="recent-card-title">{conv.title}</span>
                                        <span class="recent-card-time">{formatRelativeTime(conv.updated_at)}</span>
                                    </button>
                                {/each}
                            </div>
                        </div>
                    {:else if connected}
                        <p class="welcome-hint">Your conversations will appear here</p>
                    {/if}
                </div>
            </div>
        {:else}
            <!-- Messages -->
            <div class="messages-area" bind:this={messagesContainer}>
                {#each messages as msg (msg.id)}
                    <div class="message {msg.role}">
                        <div class="message-bubble">
                            {#if msg.role === "assistant"}
                                <pre class="assistant-text">{msg.content}</pre>
                            {:else}
                                <div class="user-text">{msg.content}</div>
                            {/if}
                        </div>
                    </div>
                {/each}

                {#if streaming && streamBuffer}
                    <div class="message assistant">
                        <div class="message-bubble">
                            <pre class="assistant-text">{streamBuffer}</pre>
                        </div>
                    </div>
                {/if}

                {#if streaming && !streamBuffer}
                    <div class="message assistant">
                        <div class="message-bubble typing-indicator">
                            <span class="dot"></span>
                            <span class="dot"></span>
                            <span class="dot"></span>
                        </div>
                    </div>
                {/if}
            </div>

            <!-- Input area -->
            <div class="input-area">
                {#if errorMessage}
                    <div class="error-bar">
                        {errorMessage}
                        <button class="error-dismiss" onclick={() => (errorMessage = "")}>
                            \u00d7
                        </button>
                    </div>
                {/if}
                <div class="input-row">
                    <textarea
                        class="chat-input"
                        bind:value={inputText}
                        onkeydown={handleKeydown}
                        placeholder="Type a message... (Shift+Enter for newline)"
                        rows="1"
                        disabled={!connected || streaming}
                    ></textarea>
                    <button
                        class="send-btn"
                        onclick={sendMessage}
                        disabled={!inputText.trim() || !connected || streaming}
                        aria-label="Send message"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                        </svg>
                    </button>
                </div>
            </div>
        {/if}
    </main>
</div>

<style>
    .chat-container {
        display: flex;
        flex-direction: row;
        height: calc(100vh - 140px);
        min-height: 400px;
        background: linear-gradient(
            145deg,
            rgba(255, 255, 255, 0.03) 0%,
            rgba(255, 255, 255, 0.01) 100%
        );
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 20px;
        overflow: hidden;
        position: relative;
    }

    /* Mobile header bar - hidden on desktop */
    .mobile-header {
        display: none;
    }

    /* Sidebar backdrop - hidden on desktop */
    .sidebar-backdrop {
        display: none;
    }

    /* Layout wrapper for sidebar + main (flex row) */
    /* Sidebar */
    .sidebar {
        width: 250px;
        min-width: 250px;
        display: flex;
        flex-direction: column;
        border-right: 1px solid rgba(255, 255, 255, 0.06);
        background: rgba(0, 0, 0, 0.15);
        padding: 16px 12px;
        gap: 12px;
    }

    .new-chat-btn {
        width: 100%;
        padding: 10px 14px;
        background: linear-gradient(135deg, #4a90e2, #357abd);
        color: #fff;
        border: none;
        border-radius: 10px;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        letter-spacing: 0.3px;
    }

    .new-chat-btn:hover:not(:disabled) {
        box-shadow: 0 4px 12px rgba(74, 144, 226, 0.3);
        transform: translateY(-1px);
    }

    .new-chat-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .conversation-list {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 2px;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
    }

    .conversation-list::-webkit-scrollbar {
        width: 4px;
    }

    .conversation-list::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
    }

    .conversation-item {
        display: flex;
        align-items: center;
        border-radius: 8px;
        transition: background 0.15s;
    }

    .conversation-item:hover {
        background: rgba(255, 255, 255, 0.05);
    }

    .conversation-item.active {
        background: rgba(74, 144, 226, 0.15);
    }

    .conversation-btn {
        flex: 1;
        background: none;
        border: none;
        color: #b0b0c8;
        padding: 10px 10px;
        text-align: left;
        cursor: pointer;
        font-size: 0.82rem;
        display: flex;
        flex-direction: column;
        gap: 2px;
        overflow: hidden;
        min-width: 0;
    }

    .conversation-item.active .conversation-btn {
        color: #e0e0e0;
    }

    .conv-title {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-weight: 500;
    }

    .conv-date {
        font-size: 0.7rem;
        color: #6b6b7e;
    }

    .delete-btn {
        background: none;
        border: none;
        color: #555;
        cursor: pointer;
        padding: 4px 8px;
        font-size: 1rem;
        border-radius: 4px;
        transition: all 0.15s;
        flex-shrink: 0;
    }

    .delete-btn:hover {
        color: #f87171;
        background: rgba(248, 113, 113, 0.1);
    }

    .delete-btn.confirm {
        color: #f87171;
        background: rgba(248, 113, 113, 0.15);
        font-weight: 700;
    }

    .no-conversations {
        text-align: center;
        color: #555;
        font-size: 0.8rem;
        padding: 20px 0;
    }

    .connection-badge {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.75rem;
        color: #6b6b7e;
        padding: 8px 10px;
        border-top: 1px solid rgba(255, 255, 255, 0.04);
    }

    .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #f87171;
        transition: background 0.3s;
    }

    .connection-badge.connected .status-dot {
        background: #4ade80;
    }

    /* Main chat area */
    .chat-main {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .welcome-screen {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow-y: auto;
        padding: 24px;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
    }

    .welcome-content {
        width: 100%;
        max-width: 600px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 24px;
    }

    .welcome-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
    }

    .welcome-icon {
        color: #4a90e2;
        opacity: 0.7;
    }

    .welcome-title {
        font-size: 1.5rem;
        font-weight: 600;
        color: #e0e0e0;
        margin: 0;
        letter-spacing: -0.3px;
    }

    .welcome-new-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px 28px;
        background: linear-gradient(135deg, #4a90e2, #357abd);
        color: #fff;
        border: none;
        border-radius: 12px;
        font-size: 0.95rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        letter-spacing: 0.3px;
    }

    .welcome-new-btn:hover:not(:disabled) {
        box-shadow: 0 6px 20px rgba(74, 144, 226, 0.35);
        transform: translateY(-2px);
    }

    .welcome-new-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .welcome-hint {
        color: #555;
        font-size: 0.85rem;
        margin: 8px 0 0;
    }

    .recent-section {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .recent-heading {
        font-size: 0.85rem;
        font-weight: 500;
        color: #6b6b7e;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        margin: 0;
        padding-left: 4px;
    }

    .recent-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 340px;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
    }

    .recent-list::-webkit-scrollbar {
        width: 4px;
    }

    .recent-list::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
    }

    .recent-card {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 14px 16px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 12px;
        cursor: pointer;
        transition: all 0.2s;
        text-align: left;
        color: inherit;
        font-family: inherit;
        width: 100%;
    }

    .recent-card:hover {
        background: rgba(255, 255, 255, 0.07);
        border-color: rgba(74, 144, 226, 0.25);
        transform: translateY(-1px);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .recent-card-title {
        color: #c0c0d8;
        font-size: 0.88rem;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
        flex: 1;
        margin-right: 12px;
    }

    .recent-card-time {
        color: #555;
        font-size: 0.75rem;
        white-space: nowrap;
        flex-shrink: 0;
    }

    /* Messages area */
    .messages-area {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
    }

    .messages-area::-webkit-scrollbar {
        width: 6px;
    }

    .messages-area::-webkit-scrollbar-track {
        background: transparent;
    }

    .messages-area::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 3px;
    }

    .message {
        display: flex;
    }

    .message.user {
        justify-content: flex-end;
    }

    .message.assistant {
        justify-content: flex-start;
    }

    .message-bubble {
        max-width: 80%;
        padding: 12px 16px;
        border-radius: 16px;
        word-break: break-word;
    }

    .message.user .message-bubble {
        background: linear-gradient(135deg, #4a90e2, #357abd);
        color: #fff;
        border-bottom-right-radius: 4px;
    }

    .message.assistant .message-bubble {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.06);
        color: #e0e0e0;
        border-bottom-left-radius: 4px;
    }

    .user-text {
        white-space: pre-wrap;
        line-height: 1.5;
        font-size: 0.9rem;
    }

    .assistant-text {
        margin: 0;
        white-space: pre-wrap;
        word-wrap: break-word;
        font-family: "JetBrains Mono", "Fira Code", "Cascadia Code", monospace;
        font-size: 0.82rem;
        line-height: 1.6;
        color: #d0d0e0;
    }

    /* Typing indicator */
    .typing-indicator {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 14px 18px;
    }

    .typing-indicator .dot {
        width: 8px;
        height: 8px;
        background: #6b6b7e;
        border-radius: 50%;
        animation: typing-bounce 1.4s ease-in-out infinite;
    }

    .typing-indicator .dot:nth-child(2) {
        animation-delay: 0.2s;
    }

    .typing-indicator .dot:nth-child(3) {
        animation-delay: 0.4s;
    }

    @keyframes typing-bounce {
        0%,
        60%,
        100% {
            transform: translateY(0);
            opacity: 0.4;
        }
        30% {
            transform: translateY(-6px);
            opacity: 1;
        }
    }

    /* Input area */
    .input-area {
        padding: 16px 20px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        background: rgba(0, 0, 0, 0.1);
    }

    .error-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: rgba(248, 113, 113, 0.1);
        border: 1px solid rgba(248, 113, 113, 0.2);
        color: #f87171;
        padding: 8px 12px;
        border-radius: 8px;
        margin-bottom: 10px;
        font-size: 0.82rem;
    }

    .error-dismiss {
        background: none;
        border: none;
        color: #f87171;
        cursor: pointer;
        font-size: 1.1rem;
        padding: 0 4px;
    }

    .input-row {
        display: flex;
        gap: 10px;
        align-items: flex-end;
    }

    .chat-input {
        flex: 1;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #e0e0e0;
        padding: 10px 14px;
        border-radius: 12px;
        font-size: 0.9rem;
        font-family: inherit;
        resize: none;
        min-height: 42px;
        max-height: 150px;
        line-height: 1.4;
        transition: border-color 0.2s;
    }

    .chat-input:focus {
        outline: none;
        border-color: rgba(74, 144, 226, 0.5);
    }

    .chat-input::placeholder {
        color: #555;
    }

    .chat-input:disabled {
        opacity: 0.5;
    }

    .send-btn {
        background: linear-gradient(135deg, #4a90e2, #357abd);
        border: none;
        color: #fff;
        width: 42px;
        height: 42px;
        border-radius: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        flex-shrink: 0;
    }

    .send-btn:hover:not(:disabled) {
        box-shadow: 0 4px 12px rgba(74, 144, 226, 0.3);
        transform: translateY(-1px);
    }

    .send-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    /* Responsive - Mobile (<768px) */
    @media (max-width: 768px) {
        .chat-container {
            flex-direction: column;
        }

        /* Mobile header bar */
        .mobile-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: rgba(0, 0, 0, 0.2);
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            flex-shrink: 0;
            z-index: 4;
        }

        .header-menu-btn,
        .header-new-btn {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #b0b0c8;
            width: 40px;
            height: 40px;
            border-radius: 10px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            flex-shrink: 0;
        }

        .header-menu-btn:hover,
        .header-new-btn:hover {
            background: rgba(255, 255, 255, 0.1);
            color: #e0e0e0;
        }

        .header-new-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }

        .header-title {
            flex: 1;
            text-align: center;
            color: #d0d0e0;
            font-size: 0.9rem;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            padding: 0 8px;
            min-width: 0;
        }

        /* Sidebar as overlay drawer */
        .sidebar {
            position: absolute;
            top: 0;
            left: 0;
            bottom: 0;
            z-index: 20;
            transform: translateX(-100%);
            transition: transform 0.25s ease;
            box-shadow: none;
            width: 280px;
            min-width: 280px;
        }

        .sidebar.open {
            transform: translateX(0);
            box-shadow: 4px 0 20px rgba(0, 0, 0, 0.5);
        }

        /* Semi-transparent backdrop */
        .sidebar-backdrop {
            display: block;
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 15;
            background: rgba(0, 0, 0, 0.5);
            border: none;
            cursor: default;
            padding: 0;
            margin: 0;
            -webkit-appearance: none;
            appearance: none;
        }

        .chat-main {
            width: 100%;
            flex: 1;
            min-height: 0;
        }

        .message-bubble {
            max-width: 95%;
        }

        .messages-area {
            padding: 12px 10px;
        }

        .input-area {
            padding: 10px;
        }

        .input-row {
            gap: 8px;
        }

        .chat-input {
            padding: 8px 12px;
            font-size: 0.88rem;
            min-height: 38px;
        }

        .send-btn {
            width: 38px;
            height: 38px;
            border-radius: 10px;
        }

        /* Smaller welcome screen elements on mobile */
        .welcome-content {
            gap: 16px;
        }

        .welcome-icon svg {
            width: 32px;
            height: 32px;
        }

        .welcome-title {
            font-size: 1.2rem;
        }

        .welcome-new-btn {
            padding: 10px 22px;
            font-size: 0.88rem;
        }

        .recent-card {
            padding: 10px 12px;
        }

        .recent-card-title {
            font-size: 0.82rem;
        }
    }
</style>
