use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::RwLock;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Claims extracted from a Keycloak JWT.
#[derive(Debug, Clone)]
pub struct UserClaims {
    pub user_id: String,
    pub username: String,
}

#[derive(Debug, Deserialize)]
struct JwtClaims {
    sub: Option<String>,
    preferred_username: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JwksResponse {
    keys: Vec<JwkKey>,
}

#[derive(Debug, Deserialize)]
struct JwkKey {
    kid: Option<String>,
    kty: String,
    n: Option<String>,
    e: Option<String>,
}

// ---------------------------------------------------------------------------
// JWKS cache
// ---------------------------------------------------------------------------

/// Holds cached JWKS keys for JWT validation.
#[derive(Clone)]
pub struct JwksCache {
    keys: Arc<RwLock<Vec<CachedKey>>>,
    jwks_url: String,
}

#[derive(Clone)]
struct CachedKey {
    kid: Option<String>,
    decoding_key: DecodingKey,
}

const DEFAULT_JWKS_URL: &str =
    "https://auth.johnsonyuen.com/realms/homekube/protocol/openid-connect/certs";

impl JwksCache {
    /// Create a new cache and fetch keys from the Keycloak JWKS endpoint.
    pub async fn new() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let jwks_url =
            std::env::var("JWKS_URL").unwrap_or_else(|_| DEFAULT_JWKS_URL.to_string());
        let cache = Self {
            keys: Arc::new(RwLock::new(Vec::new())),
            jwks_url,
        };
        cache.refresh().await?;
        Ok(cache)
    }

    /// Fetch (or re-fetch) JWKS keys from the identity provider.
    async fn refresh(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let resp: JwksResponse = reqwest::get(&self.jwks_url).await?.json().await?;
        let mut cached = Vec::new();
        for key in &resp.keys {
            if key.kty != "RSA" {
                continue;
            }
            let (Some(n), Some(e)) = (&key.n, &key.e) else {
                continue;
            };
            // jsonwebtoken expects standard base64; JWKS uses base64url-unpadded.
            let n_bytes = base64_url_decode(n)?;
            let e_bytes = base64_url_decode(e)?;
            let decoding_key = DecodingKey::from_rsa_raw_components(&n_bytes, &e_bytes);
            cached.push(CachedKey {
                kid: key.kid.clone(),
                decoding_key,
            });
        }
        *self.keys.write().await = cached;
        tracing::info!(count = resp.keys.len(), "refreshed JWKS keys");
        Ok(())
    }

    /// Validate a JWT token string and return the extracted claims.
    pub async fn validate(&self, token: &str) -> Result<UserClaims, String> {
        // Decode header to find kid.
        let header = jsonwebtoken::decode_header(token).map_err(|e| format!("bad JWT header: {e}"))?;

        let keys = self.keys.read().await;
        let decoding_key = if let Some(kid) = &header.kid {
            keys.iter()
                .find(|k| k.kid.as_deref() == Some(kid))
                .map(|k| &k.decoding_key)
        } else {
            keys.first().map(|k| &k.decoding_key)
        };

        let decoding_key = match decoding_key {
            Some(k) => k,
            None => {
                // Key not found — try refreshing once (key rotation).
                drop(keys);
                if let Err(e) = self.refresh().await {
                    tracing::warn!(error = %e, "failed to refresh JWKS");
                }
                let keys = self.keys.read().await;
                let k = if let Some(kid) = &header.kid {
                    keys.iter()
                        .find(|k| k.kid.as_deref() == Some(kid))
                        .map(|k| &k.decoding_key)
                } else {
                    keys.first().map(|k| &k.decoding_key)
                };
                return match k {
                    Some(dk) => do_validate(token, dk),
                    None => Err("no matching JWKS key found".to_string()),
                };
            }
        };

        do_validate(token, decoding_key)
    }
}

/// Perform the actual JWT decode and claim extraction.
fn do_validate(token: &str, key: &DecodingKey) -> Result<UserClaims, String> {
    let mut validation = Validation::new(Algorithm::RS256);
    // Match existing service pattern: issuer = any, audience = any.
    validation.validate_aud = false;
    validation.set_required_spec_claims::<&str>(&["exp", "sub"]);

    let token_data = decode::<JwtClaims>(token, key, &validation)
        .map_err(|e| format!("JWT validation failed: {e}"))?;

    let user_id = token_data
        .claims
        .sub
        .ok_or_else(|| "missing sub claim".to_string())?;
    let username = token_data
        .claims
        .preferred_username
        .unwrap_or_else(|| user_id.clone());

    Ok(UserClaims { user_id, username })
}

/// Decode a base64url-encoded (no padding) string to bytes.
fn base64_url_decode(input: &str) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    // Convert base64url to standard base64 with padding.
    let standard = input.replace('-', "+").replace('_', "/");
    let padded = match standard.len() % 4 {
        2 => format!("{standard}=="),
        3 => format!("{standard}="),
        _ => standard,
    };
    Ok(BASE64.decode(padded)?)
}
