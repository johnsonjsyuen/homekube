use crate::state::AppState;
use axum::{
    extract::{Request, State},
    http::{StatusCode, header},
    middleware::Next,
    response::Response,
};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use serde::Deserialize;
use std::collections::HashMap;

/// Represents an authenticated user extracted from the JWT token.
/// This is added to request extensions by the auth middleware.
#[derive(Debug, Clone)]
pub struct AuthenticatedUser {
    pub username: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct KeycloakClaims {
    exp: usize,
    iat: usize,
    sub: String,
    preferred_username: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JwksResponse {
    keys: Vec<JwkKey>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct JwkKey {
    kid: String,
    kty: String,
    alg: Option<String>,
    n: String,
    e: String,
}

async fn fetch_jwks(
    keycloak_url: &str,
    realm: &str,
) -> Result<HashMap<String, DecodingKey>, String> {
    let jwks_url = format!(
        "{}/realms/{}/protocol/openid-connect/certs",
        keycloak_url, realm
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&jwks_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch JWKS: {}", e))?;

    let jwks: JwksResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse JWKS: {}", e))?;

    let mut keys = HashMap::new();
    for key in jwks.keys {
        if key.kty == "RSA" {
            match DecodingKey::from_rsa_components(&key.n, &key.e) {
                Ok(decoding_key) => {
                    keys.insert(key.kid.clone(), decoding_key);
                }
                Err(e) => {
                    tracing::error!(kid = %key.kid, error = %e, "Failed to create decoding key");
                }
            }
        }
    }

    Ok(keys)
}

async fn validate_token(state: &AppState, token: &str) -> Result<KeycloakClaims, String> {
    // Decode header to get kid
    let header = decode_header(token).map_err(|e| format!("Invalid token header: {}", e))?;

    let kid = header.kid.ok_or("Token missing kid")?;

    // Check cache or fetch JWKS
    let decoding_key = {
        let cache = state.jwks_cache.read().await;
        if let Some(key) = cache.keys.get(&kid) {
            // Check if cache is still valid (less than 1 hour old)
            if let Some(last_fetched) = cache.last_fetched {
                if last_fetched.elapsed() < std::time::Duration::from_secs(3600) {
                    Some(key.clone())
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    };

    let decoding_key = match decoding_key {
        Some(key) => key,
        None => {
            // Fetch new JWKS
            let new_keys = fetch_jwks(&state.keycloak_url, &state.keycloak_realm).await?;
            let key = new_keys
                .get(&kid)
                .cloned()
                .ok_or_else(|| format!("Key with kid {} not found", kid))?;

            // Update cache
            let mut cache = state.jwks_cache.write().await;
            cache.keys = new_keys;
            cache.last_fetched = Some(std::time::Instant::now());

            key
        }
    };

    // Validate token
    let mut validation = Validation::new(Algorithm::RS256);
    validation.validate_exp = true;
    validation.set_audience(&[&state.keycloak_audience]);

    let token_data = decode::<KeycloakClaims>(token, &decoding_key, &validation)
        .map_err(|e| format!("Token validation failed: {}", e))?;

    Ok(token_data.claims)
}

pub async fn auth_middleware(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, (StatusCode, String)> {
    // Skip auth in test mode - use a default test user
    if std::env::var("TTS_TEST_MODE").is_ok() {
        request.extensions_mut().insert(AuthenticatedUser {
            username: "test_user".to_string(),
        });
        return Ok(next.run(request).await);
    }

    let auth_header = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok());

    let token = match auth_header {
        Some(h) if h.starts_with("Bearer ") => &h[7..],
        _ => {
            return Err((
                StatusCode::UNAUTHORIZED,
                "Missing or invalid Authorization header".to_string(),
            ));
        }
    };

    match validate_token(&state, token).await {
        Ok(claims) => {
            let username = claims
                .preferred_username
                .unwrap_or_else(|| claims.sub.clone());
            tracing::info!("Authenticated user: {}", username);

            // Store authenticated user in request extensions
            request
                .extensions_mut()
                .insert(AuthenticatedUser { username });

            Ok(next.run(request).await)
        }
        Err(e) => {
            tracing::warn!("Authentication failed: {}", e);
            Err((
                StatusCode::UNAUTHORIZED,
                format!("Authentication failed: {}", e),
            ))
        }
    }
}
