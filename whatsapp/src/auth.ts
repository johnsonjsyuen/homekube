import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import type { Request, Response, NextFunction } from 'express';

const KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'http://keycloak.keycloak.svc.cluster.local';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'homekube';
const KEYCLOAK_AUDIENCE = process.env.KEYCLOAK_AUDIENCE || 'whatsapp';

const client = jwksClient({
    jwksUri: `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/certs`,
    cache: true,
    cacheMaxAge: 3600000, // 1 hour
});

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback): void {
    if (!header.kid) {
        callback(new Error('No kid in token header'));
        return;
    }
    client.getSigningKey(header.kid, (err, key) => {
        if (err) {
            callback(err);
            return;
        }
        const signingKey = key?.getPublicKey();
        callback(null, signingKey);
    });
}

export interface TokenPayload {
    sub: string;
    preferred_username: string;
    exp: number;
    iat: number;
    aud?: string | string[];
    azp?: string;
    realm_access?: {
        roles: string[];
    };
}

const WHATSAPP_SERVICE_ROLE = 'whatsapp-service';

export class AuthorizationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AuthorizationError';
    }
}

export function isServiceAccount(payload: TokenPayload): boolean {
    const roles = payload.realm_access?.roles;
    return Array.isArray(roles) && roles.includes(WHATSAPP_SERVICE_ROLE);
}

export function getCallerUserId(payload: TokenPayload): string {
    return payload.preferred_username || payload.sub;
}

export function resolveUserId(payload: TokenPayload, requestedUserId?: string): string {
    const callerUserId = getCallerUserId(payload);

    if (!requestedUserId || requestedUserId === callerUserId) {
        return callerUserId;
    }

    if (isServiceAccount(payload)) {
        return requestedUserId;
    }

    throw new AuthorizationError(
        `User ${callerUserId} is not authorized to act on behalf of ${requestedUserId}`
    );
}

export function validateToken(token: string): Promise<TokenPayload> {
    return new Promise((resolve, reject) => {
        jwt.verify(token, getKey, {
            algorithms: ['RS256'],
        }, (err, decoded) => {
            if (err) {
                reject(err);
                return;
            }
            const payload = decoded as TokenPayload;
            // Check audience - Keycloak puts the client_id in azp or aud
            const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
            if (!audiences.includes(KEYCLOAK_AUDIENCE) && payload.azp !== KEYCLOAK_AUDIENCE) {
                // Also accept 'account' as a common Keycloak audience for user tokens
                if (!audiences.includes('account')) {
                    reject(new Error(`Invalid audience: expected ${KEYCLOAK_AUDIENCE}`));
                    return;
                }
            }
            resolve(payload);
        });
    });
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid Authorization header' });
        return;
    }

    const token = authHeader.substring(7);
    try {
        const payload = await validateToken(token);
        (req as any).user = payload;
        next();
    } catch (err: any) {
        console.error('[Auth] Token validation failed:', err.message);
        res.status(401).json({ error: 'Invalid token' });
    }
}
