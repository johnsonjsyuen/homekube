import { Router } from 'express';
import QRCode from 'qrcode';
import type { Pool } from 'pg';
import type { SessionManager } from '../session-manager.js';
import { resolveUserId, getCallerUserId, isServiceAccount, AuthorizationError, type TokenPayload } from '../auth.js';
import { phoneToJid } from '../utils.js';

export function createRestRouter(pool: Pool, sessionManager: SessionManager): Router {
    const router = Router();

    // POST /api/link - Start QR-code-based linking (primary method)
    router.post('/link', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            const userId = getCallerUserId(user);
            await sessionManager.startLinking(userId);
            res.json({ status: 'pairing' });
        } catch (err: any) {
            console.error('[REST] Link error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/qr - Get current QR code as data URL
    router.get('/qr', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            const userId = getCallerUserId(user);
            const qrData = sessionManager.getQrCode(userId);
            if (!qrData) {
                res.json({ qr: null });
                return;
            }
            const dataUrl = await QRCode.toDataURL(qrData, {
                width: 300,
                margin: 2,
                color: { dark: '#000000', light: '#ffffff' },
            });
            res.json({ qr: dataUrl });
        } catch (err: any) {
            console.error('[REST] QR error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // POST /api/register - Link WhatsApp via pairing code (alternative)
    router.post('/register', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            const { phoneNumber } = req.body;

            if (!phoneNumber) {
                res.status(400).json({ error: 'phoneNumber is required' });
                return;
            }

            const cleanPhone = phoneNumber.replace(/\D/g, '');
            if (cleanPhone.length < 10) {
                res.status(400).json({ error: 'Invalid phone number' });
                return;
            }

            const pairingCode = await sessionManager.startPairing(getCallerUserId(user), cleanPhone);
            res.json({ pairingCode, status: 'pairing' });
        } catch (err: any) {
            console.error('[REST] Register error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/status - Get session status
    router.get('/status', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            const userId = getCallerUserId(user);

            const result = await pool.query(
                'SELECT status, phone_number, whatsapp_jid, error_message, paired_at, last_connected_at FROM sessions WHERE user_id = $1',
                [userId]
            );

            if (result.rows.length === 0) {
                res.json({ status: 'unregistered' });
                return;
            }

            const row = result.rows[0];
            res.json({
                status: row.status,
                phoneNumber: row.phone_number,
                whatsappJid: row.whatsapp_jid,
                errorMessage: row.error_message,
                pairedAt: row.paired_at,
                lastConnectedAt: row.last_connected_at,
            });
        } catch (err: any) {
            console.error('[REST] Status error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // POST /api/disconnect - Disconnect WhatsApp session
    router.post('/disconnect', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            const userId = getCallerUserId(user);
            await sessionManager.disconnectSession(userId);
            res.json({ status: 'disconnected' });
        } catch (err: any) {
            console.error('[REST] Disconnect error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // POST /api/send - Send a message
    router.post('/send', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            const { userId, recipientPhone, message } = req.body;

            // Determine which user's session to use (with authorization check)
            let senderId: string;
            try {
                senderId = resolveUserId(user, userId);
            } catch (err) {
                if (err instanceof AuthorizationError) {
                    console.warn(`[Auth] Authorization denied: ${err.message}`);
                    res.status(403).json({ error: err.message });
                    return;
                }
                throw err;
            }

            if (!recipientPhone || !message) {
                res.status(400).json({ error: 'recipientPhone and message are required' });
                return;
            }

            const jid = phoneToJid(recipientPhone);
            console.log(`[REST] Sending message from ${senderId} to ${jid}`);
            const sourceService = userId ? (user.preferred_username || user.azp || 'service') : undefined;

            // Timeout after 30 seconds
            const timeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Send timed out after 30s')), 30000)
            );
            const messageId = await Promise.race([
                sessionManager.sendMessage(senderId, jid, message, sourceService),
                timeout,
            ]);

            console.log(`[REST] Message sent: ${messageId}`);
            res.json({ messageId, status: 'sent' });
        } catch (err: any) {
            console.error('[REST] Send error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // POST /api/sessions/lookup - Bulk lookup connected sessions by user IDs (service accounts only)
    router.post('/sessions/lookup', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            if (!isServiceAccount(user)) {
                res.status(403).json({ error: 'Forbidden: service account required' });
                return;
            }

            const { userIds } = req.body;
            if (!Array.isArray(userIds) || userIds.length === 0 || userIds.length > 500) {
                res.status(400).json({ error: 'userIds must be a non-empty array (max 500)' });
                return;
            }
            if (!userIds.every((id: unknown) => typeof id === 'string')) {
                res.status(400).json({ error: 'userIds must contain only strings' });
                return;
            }

            const result = await pool.query(
                `SELECT user_id, whatsapp_jid FROM sessions
                 WHERE user_id = ANY($1) AND status = 'connected' AND whatsapp_jid IS NOT NULL`,
                [userIds]
            );

            const sessions = result.rows.map((row: any) => ({
                userId: row.user_id,
                phone: row.whatsapp_jid.split(':')[0].split('@')[0],
            }));

            res.json({ sessions });
        } catch (err: any) {
            console.error('[REST] Sessions lookup error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/messages - Get message history
    router.get('/messages', async (req, res) => {
        try {
            const user = (req as any).user as TokenPayload;
            const userId = getCallerUserId(user);
            const remotePhone = req.query.remotePhone as string;
            const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
            const offset = parseInt(req.query.offset as string) || 0;

            let query: string;
            let params: any[];

            if (remotePhone) {
                const jid = phoneToJid(remotePhone);
                query = 'SELECT * FROM messages WHERE user_id = $1 AND remote_jid = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4';
                params = [userId, jid, limit, offset];
            } else {
                query = 'SELECT * FROM messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3';
                params = [userId, limit, offset];
            }

            const result = await pool.query(query, params);
            res.json({
                messages: result.rows.map(row => ({
                    id: row.id,
                    direction: row.direction,
                    remoteJid: row.remote_jid,
                    messageText: row.message_text,
                    messageId: row.message_id,
                    status: row.status,
                    sourceService: row.source_service,
                    createdAt: row.created_at,
                })),
            });
        } catch (err: any) {
            console.error('[REST] Messages error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    return router;
}
