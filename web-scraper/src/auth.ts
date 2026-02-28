import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import type { Request, Response, NextFunction } from 'express';

const KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'http://keycloak.keycloak.svc.cluster.local';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'homekube';

const client = jwksClient({
    jwksUri: `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/certs`,
    cache: true,
    cacheMaxAge: 3600000,
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

function validateToken(token: string): Promise<TokenPayload> {
    return new Promise((resolve, reject) => {
        jwt.verify(token, getKey, {
            algorithms: ['RS256'],
        }, (err, decoded) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(decoded as TokenPayload);
        });
    });
}

export function getCallerUserId(payload: TokenPayload): string {
    return payload.preferred_username || payload.sub;
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
