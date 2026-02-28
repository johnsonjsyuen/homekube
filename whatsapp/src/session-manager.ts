import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import type { WASocket } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import type { Pool } from 'pg';
import pino from 'pino';
import { usePostgresAuthState } from './db-auth-state.js';
import { messagesSentTotal, messagesReceivedTotal, activeSessions, sessionConnectsTotal } from './metrics.js';

const logger = pino({ level: 'silent' });

interface UserSession {
    socket: WASocket;
    messageListeners: Set<(msg: IncomingMessage) => void>;
    latestQr: string | null;
    wasConnected: boolean;
}

export interface IncomingMessage {
    remoteJid: string;
    text: string;
    messageId: string;
    timestamp: number;
}

export class SessionManager {
    private sessions = new Map<string, UserSession>();
    private pairingSessions = new Set<string>();
    private pool: Pool;

    constructor(pool: Pool) {
        this.pool = pool;
    }

    /**
     * Start a QR-code-based linking session. The QR is emitted by baileys
     * and stored in-memory; the frontend polls GET /api/qr to retrieve it.
     */
    async startLinking(userId: string): Promise<void> {
        await this.disconnectSession(userId);

        // Clear stale auth state so baileys starts fresh
        await this.pool.query('DELETE FROM auth_creds WHERE user_id = $1', [userId]);
        await this.pool.query('DELETE FROM auth_keys WHERE user_id = $1', [userId]);

        const { state, saveCreds } = await usePostgresAuthState(this.pool, userId);
        const { version } = await fetchLatestBaileysVersion();

        const socket = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            browser: ['Homekube', 'Chrome', '127.0.0'],
        });

        const session: UserSession = {
            socket,
            messageListeners: new Set(),
            latestQr: null,
            wasConnected: false,
        };
        this.sessions.set(userId, session);
        this.pairingSessions.add(userId);

        await this.pool.query(
            `INSERT INTO sessions (user_id, status, updated_at)
             VALUES ($1, 'pairing', NOW())
             ON CONFLICT (user_id)
             DO UPDATE SET status = 'pairing', error_message = NULL, updated_at = NOW()`,
            [userId]
        );

        this.setupEventHandlers(userId, socket, saveCreds);
    }

    /**
     * Start a pairing-code-based linking session (alternative to QR).
     */
    async startPairing(userId: string, phoneNumber: string): Promise<string> {
        await this.disconnectSession(userId);

        await this.pool.query('DELETE FROM auth_creds WHERE user_id = $1', [userId]);
        await this.pool.query('DELETE FROM auth_keys WHERE user_id = $1', [userId]);

        const { state, saveCreds } = await usePostgresAuthState(this.pool, userId);
        const { version } = await fetchLatestBaileysVersion();

        const socket = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            browser: ['Homekube', 'Chrome', '127.0.0'],
        });

        const session: UserSession = {
            socket,
            messageListeners: new Set(),
            latestQr: null,
            wasConnected: false,
        };
        this.sessions.set(userId, session);
        this.pairingSessions.add(userId);

        await this.pool.query(
            `INSERT INTO sessions (user_id, phone_number, status, updated_at)
             VALUES ($1, $2, 'pairing', NOW())
             ON CONFLICT (user_id)
             DO UPDATE SET phone_number = $2, status = 'pairing', error_message = NULL, updated_at = NOW()`,
            [userId, phoneNumber]
        );

        this.setupEventHandlers(userId, socket, saveCreds);

        // Wait for socket to be ready, then request pairing code
        const code = await new Promise<string>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timed out waiting for WhatsApp connection'));
            }, 20000);

            const onUpdate = async (update: any) => {
                if (update.connection === 'connecting' || update.qr) {
                    socket.ev.off('connection.update', onUpdate);
                    await new Promise(r => setTimeout(r, 2000));
                    try {
                        const pairingCode = await socket.requestPairingCode(phoneNumber);
                        clearTimeout(timeout);
                        console.log(`[Session] Pairing code for ${userId}: ${pairingCode}`);
                        resolve(pairingCode);
                    } catch (err) {
                        clearTimeout(timeout);
                        reject(err);
                    }
                } else if (update.connection === 'close') {
                    socket.ev.off('connection.update', onUpdate);
                    clearTimeout(timeout);
                    const statusCode = (update.lastDisconnect?.error as Boom)?.output?.statusCode;
                    reject(new Error(`Connection closed during pairing (code: ${statusCode})`));
                }
            };

            socket.ev.on('connection.update', onUpdate);
        });

        return code;
    }

    getQrCode(userId: string): string | null {
        return this.sessions.get(userId)?.latestQr ?? null;
    }

    private setupEventHandlers(userId: string, socket: WASocket, saveCreds: () => Promise<void>): void {
        socket.ev.on('creds.update', saveCreds);

        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // Store latest QR for polling
            if (qr) {
                const session = this.sessions.get(userId);
                if (session) {
                    session.latestQr = qr;
                    console.log(`[Session] New QR code for ${userId}`);
                }
            }

            if (connection === 'open') {
                console.log(`[Session] ${userId} connected`);
                sessionConnectsTotal.inc({ status: 'success' });
                const session = this.sessions.get(userId);
                if (session && !session.wasConnected) {
                    activeSessions.inc();
                    session.wasConnected = true;
                }
                this.pairingSessions.delete(userId);
                const jid = socket.user?.id;
                await this.pool.query(
                    `UPDATE sessions SET status = 'connected', whatsapp_jid = $2,
                     paired_at = COALESCE(paired_at, NOW()), last_connected_at = NOW(),
                     error_message = NULL, updated_at = NOW()
                     WHERE user_id = $1`,
                    [userId, jid]
                );
            }

            if (connection === 'close') {
                const session = this.sessions.get(userId);
                if (session?.wasConnected) {
                    activeSessions.dec();
                    session.wasConnected = false;
                } else {
                    sessionConnectsTotal.inc({ status: 'failure' });
                }
                const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                const isPairing = this.pairingSessions.has(userId);
                // Always reconnect on 515 (restart required) — this is expected after QR pairing
                const isRestartRequired = statusCode === DisconnectReason.restartRequired;
                const shouldReconnect = isRestartRequired || (statusCode !== DisconnectReason.loggedOut && !isPairing);

                console.log(`[Session] ${userId} disconnected, code: ${statusCode}, pairing: ${isPairing}, restart: ${isRestartRequired}, reconnect: ${shouldReconnect}`);

                if (shouldReconnect) {
                    // Reconnect — clear pairing flag since we're now restoring
                    this.pairingSessions.delete(userId);
                    this.sessions.delete(userId);
                    try {
                        await this.restoreSession(userId);
                    } catch (err: any) {
                        console.error(`[Session] Failed to reconnect ${userId}:`, err.message);
                        await this.pool.query(
                            `UPDATE sessions SET status = 'disconnected', error_message = $2, updated_at = NOW()
                             WHERE user_id = $1`,
                            [userId, err.message]
                        );
                    }
                } else if (!isPairing) {
                    // Logged out (not during pairing) - clean up auth state
                    this.sessions.delete(userId);
                    await this.pool.query(
                        `UPDATE sessions SET status = 'disconnected', error_message = 'Logged out', updated_at = NOW()
                         WHERE user_id = $1`,
                        [userId]
                    );
                    await this.pool.query('DELETE FROM auth_creds WHERE user_id = $1', [userId]);
                    await this.pool.query('DELETE FROM auth_keys WHERE user_id = $1', [userId]);
                }
            }
        });

        socket.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
            if (type !== 'notify') return;

            for (const msg of msgs) {
                if (msg.key.fromMe) continue;
                const text = msg.message?.conversation
                    || msg.message?.extendedTextMessage?.text
                    || '';
                if (!text) continue;

                const remoteJid = msg.key.remoteJid || '';
                const incomingMsg: IncomingMessage = {
                    remoteJid,
                    text,
                    messageId: msg.key.id || '',
                    timestamp: typeof msg.messageTimestamp === 'number'
                        ? msg.messageTimestamp
                        : Date.now() / 1000,
                };

                messagesReceivedTotal.inc();

                // Store in DB
                await this.pool.query(
                    `INSERT INTO messages (user_id, direction, remote_jid, message_text, message_id, status, created_at)
                     VALUES ($1, 'inbound', $2, $3, $4, 'received', NOW())`,
                    [userId, remoteJid, text, msg.key.id]
                );

                // Notify listeners
                const session = this.sessions.get(userId);
                if (session) {
                    for (const listener of session.messageListeners) {
                        try {
                            listener(incomingMsg);
                        } catch (err) {
                            console.error('[Session] Message listener error:', err);
                        }
                    }
                }
            }
        });
    }

    async sendMessage(userId: string, recipientJid: string, text: string, sourceService?: string): Promise<string> {
        const session = this.sessions.get(userId);
        if (!session) {
            throw new Error(`No active session for user ${userId}`);
        }

        const result = await session.socket.sendMessage(recipientJid, { text });
        const messageId = result?.key?.id || '';
        messagesSentTotal.inc();

        // Store outbound message
        await this.pool.query(
            `INSERT INTO messages (user_id, direction, remote_jid, message_text, message_id, status, source_service, created_at)
             VALUES ($1, 'outbound', $2, $3, $4, 'sent', $5, NOW())`,
            [userId, recipientJid, text, messageId, sourceService]
        );

        return messageId;
    }

    async disconnectSession(userId: string): Promise<void> {
        const session = this.sessions.get(userId);
        if (session) {
            session.socket.end(undefined);
            this.sessions.delete(userId);
        }
        await this.pool.query(
            `UPDATE sessions SET status = 'disconnected', updated_at = NOW() WHERE user_id = $1`,
            [userId]
        );
    }

    async restoreSession(userId: string): Promise<void> {
        const { state, saveCreds } = await usePostgresAuthState(this.pool, userId);
        const { version } = await fetchLatestBaileysVersion();

        const socket = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            browser: ['Homekube', 'Chrome', '127.0.0'],
        });

        const session: UserSession = {
            socket,
            messageListeners: new Set(),
            latestQr: null,
            wasConnected: false,
        };
        this.sessions.set(userId, session);

        this.setupEventHandlers(userId, socket, saveCreds);
    }

    async restoreAllSessions(): Promise<void> {
        const result = await this.pool.query(
            "SELECT user_id FROM sessions WHERE status = 'connected'"
        );

        console.log(`[Session] Restoring ${result.rows.length} sessions...`);
        for (const row of result.rows) {
            try {
                await this.restoreSession(row.user_id);
                console.log(`[Session] Restored session for ${row.user_id}`);
            } catch (err: any) {
                console.error(`[Session] Failed to restore ${row.user_id}:`, err.message);
                await this.pool.query(
                    `UPDATE sessions SET status = 'disconnected', error_message = $2, updated_at = NOW()
                     WHERE user_id = $1`,
                    [row.user_id, `Restore failed: ${err.message}`]
                );
            }
        }
    }

    onIncomingMessage(userId: string, callback: (msg: IncomingMessage) => void): () => void {
        const session = this.sessions.get(userId);
        if (!session) {
            throw new Error(`No active session for user ${userId}`);
        }
        session.messageListeners.add(callback);
        return () => {
            session.messageListeners.delete(callback);
        };
    }

    getSession(userId: string): UserSession | undefined {
        return this.sessions.get(userId);
    }

    isConnected(userId: string): boolean {
        const session = this.sessions.get(userId);
        return !!session && session.socket.user !== undefined;
    }
}
