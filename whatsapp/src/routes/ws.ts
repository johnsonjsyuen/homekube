import type { IncomingMessage as HttpRequest } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { Pool } from 'pg';
import { validateToken, resolveUserId, AuthorizationError, type TokenPayload } from '../auth.js';
import type { SessionManager, IncomingMessage } from '../session-manager.js';

function phoneToJid(phone: string): string {
    let digits = phone.replace(/\D/g, '');
    if (digits.startsWith('0') && digits.length === 10) {
        digits = '61' + digits.slice(1);
    }
    return `${digits}@s.whatsapp.net`;
}

export function setupWebSocket(server: Server, pool: Pool, sessionManager: SessionManager): void {
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request: HttpRequest, socket, head) => {
        const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

        if (pathname === '/ws/conversation') {
            wss.handleUpgrade(request, socket as any, head, (ws) => {
                handleConnection(ws, pool, sessionManager);
            });
        } else {
            socket.destroy();
        }
    });
}

function handleConnection(ws: WebSocket, pool: Pool, sessionManager: SessionManager): void {
    let authenticated = false;
    let user: TokenPayload | null = null;
    let conversationUserId: string | null = null;
    let remoteJid: string | null = null;
    let unsubscribe: (() => void) | null = null;

    // Auth timeout - must authenticate within 10 seconds
    const authTimeout = setTimeout(() => {
        if (!authenticated) {
            ws.send(JSON.stringify({ type: 'error', message: 'Authentication timeout' }));
            ws.close(4001, 'Authentication timeout');
        }
    }, 10000);

    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data.toString());

            if (!authenticated) {
                if (msg.type !== 'auth') {
                    ws.send(JSON.stringify({ type: 'error', message: 'First message must be auth' }));
                    ws.close(4002, 'Auth required');
                    return;
                }

                const token = msg.token?.replace('Bearer ', '') || '';
                try {
                    user = await validateToken(token);
                    authenticated = true;
                    clearTimeout(authTimeout);
                    ws.send(JSON.stringify({
                        type: 'auth_ok',
                        username: user.preferred_username || user.sub,
                    }));
                } catch (err: any) {
                    ws.send(JSON.stringify({ type: 'error', message: `Authentication failed: ${err.message}` }));
                    ws.close(4003, 'Auth failed');
                }
                return;
            }

            switch (msg.type) {
                case 'start_conversation': {
                    let targetUserId: string;
                    try {
                        targetUserId = resolveUserId(user!, msg.userId);
                    } catch (err) {
                        if (err instanceof AuthorizationError) {
                            console.warn(`[Auth] WS authorization denied: ${err.message}`);
                            ws.send(JSON.stringify({ type: 'error', message: err.message }));
                            return;
                        }
                        throw err;
                    }
                    const remotePhone = msg.remotePhone;

                    if (!remotePhone) {
                        ws.send(JSON.stringify({ type: 'error', message: 'remotePhone is required' }));
                        return;
                    }

                    if (!sessionManager.getSession(targetUserId)) {
                        ws.send(JSON.stringify({ type: 'error', message: `No active session for user ${targetUserId}` }));
                        return;
                    }

                    conversationUserId = targetUserId;
                    remoteJid = phoneToJid(remotePhone);

                    // Subscribe to incoming messages
                    try {
                        unsubscribe = sessionManager.onIncomingMessage(targetUserId, (incomingMsg: IncomingMessage) => {
                            if (incomingMsg.remoteJid === remoteJid && ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({
                                    type: 'incoming_message',
                                    text: incomingMsg.text,
                                    remoteJid: incomingMsg.remoteJid,
                                    messageId: incomingMsg.messageId,
                                    timestamp: new Date(incomingMsg.timestamp * 1000).toISOString(),
                                }));
                            }
                        });
                    } catch (err: any) {
                        ws.send(JSON.stringify({ type: 'error', message: err.message }));
                        return;
                    }

                    ws.send(JSON.stringify({
                        type: 'conversation_started',
                        remoteJid,
                    }));

                    // Send recent message history
                    const history = await pool.query(
                        'SELECT * FROM messages WHERE user_id = $1 AND remote_jid = $2 ORDER BY created_at DESC LIMIT 50',
                        [targetUserId, remoteJid]
                    );

                    ws.send(JSON.stringify({
                        type: 'history',
                        messages: history.rows.reverse().map(row => ({
                            direction: row.direction,
                            text: row.message_text,
                            messageId: row.message_id,
                            timestamp: row.created_at,
                        })),
                    }));
                    break;
                }

                case 'send_message': {
                    if (!conversationUserId || !remoteJid) {
                        ws.send(JSON.stringify({ type: 'error', message: 'No active conversation. Send start_conversation first.' }));
                        return;
                    }

                    const sourceService = user!.azp || user!.preferred_username || 'ws-client';
                    const messageId = await sessionManager.sendMessage(
                        conversationUserId,
                        remoteJid,
                        msg.text,
                        sourceService
                    );

                    ws.send(JSON.stringify({
                        type: 'message_sent',
                        messageId,
                        timestamp: new Date().toISOString(),
                    }));
                    break;
                }

                default:
                    ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
            }
        } catch (err: any) {
            console.error('[WS] Error handling message:', err);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'error', message: err.message }));
            }
        }
    });

    ws.on('close', () => {
        clearTimeout(authTimeout);
        if (unsubscribe) {
            unsubscribe();
        }
    });

    ws.on('error', (err) => {
        console.error('[WS] Connection error:', err);
        clearTimeout(authTimeout);
        if (unsubscribe) {
            unsubscribe();
        }
    });
}
