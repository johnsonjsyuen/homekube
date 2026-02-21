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
    if std::env::var("STT_TEST_MODE").is_ok() {
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

/// Extract token from query string for WebSocket connections
/// (since WebSocket can't use custom headers in browser)
pub fn extract_token_from_query(query: Option<&str>) -> Option<String> {
    query.and_then(|q| {
        q.split('&')
            .find_map(|pair| {
                let mut parts = pair.splitn(2, '=');
                let key = parts.next()?;
                let value = parts.next()?;
                if key == "token" {
                    Some(value.to_string())
                } else {
                    None
                }
            })
    })
}

pub async fn validate_ws_token(state: &AppState, token: &str) -> Result<AuthenticatedUser, String> {
    // Skip auth in test mode
    if std::env::var("STT_TEST_MODE").is_ok() {
        return Ok(AuthenticatedUser {
            username: "test_user".to_string(),
        });
    }

    let claims = validate_token(state, token).await?;
    let username = claims
        .preferred_username
        .unwrap_or_else(|| claims.sub.clone());

    Ok(AuthenticatedUser { username })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{AppState, JwksCache};
    use std::sync::Arc;
    use tokio::sync::RwLock;

    use axum::{body::Body, http::Request, middleware as axum_mw, routing::get, Router};
    use tower::ServiceExt;

    fn create_test_state() -> AppState {
        AppState {
            jwks_cache: Arc::new(RwLock::new(JwksCache::default())),
            keycloak_url: "http://localhost:8080".to_string(),
            keycloak_realm: "test".to_string(),
            keycloak_audience: "test".to_string(),
            whisper_url: "http://localhost:8000".to_string(),
        }
    }

    // ── extract_token_from_query tests ──────────────────────────────

    #[test]
    fn test_extract_token_basic() {
        let result = extract_token_from_query(Some("token=abc123"));
        assert_eq!(result, Some("abc123".to_string()));
    }

    #[test]
    fn test_extract_token_multiple_params() {
        let result = extract_token_from_query(Some("lang=en&token=abc123&mode=live"));
        assert_eq!(result, Some("abc123".to_string()));
    }

    #[test]
    fn test_extract_token_none_query() {
        let result = extract_token_from_query(None);
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_token_no_token_param() {
        let result = extract_token_from_query(Some("lang=en&mode=live"));
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_token_empty_query() {
        let result = extract_token_from_query(Some(""));
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_token_token_no_value() {
        // "token" with no '=' sign — splitn(2, '=') yields only one part, so
        // parts.next() for the value returns None.
        let result = extract_token_from_query(Some("token"));
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_token_empty_value() {
        let result = extract_token_from_query(Some("token="));
        assert_eq!(result, Some("".to_string()));
    }

    #[test]
    fn test_extract_token_special_chars() {
        // The function does no URL decoding, so percent-encoded characters are
        // returned as-is.
        let result = extract_token_from_query(Some("token=abc%20def"));
        assert_eq!(result, Some("abc%20def".to_string()));
    }

    #[test]
    fn test_extract_token_first_param() {
        let result = extract_token_from_query(Some("token=first&other=second"));
        assert_eq!(result, Some("first".to_string()));
    }

    #[test]
    fn test_extract_token_value_with_equals() {
        // splitn(2, '=') splits at most once, so "abc=def" stays intact.
        let result = extract_token_from_query(Some("token=abc=def"));
        assert_eq!(result, Some("abc=def".to_string()));
    }

    // ── auth_middleware tests ───────────────────────────────────────
    //
    // NOTE: Tests that manipulate `STT_TEST_MODE` use std::env::set_var /
    // remove_var which affect the entire process.  Because cargo test runs
    // tests in parallel by default, these tests can interfere with each
    // other.  Run with `cargo test -- --test-threads=1` for deterministic
    // results, or accept the small race window in CI.

    async fn dummy_handler() -> &'static str {
        "ok"
    }

    fn build_test_app(state: AppState) -> Router {
        Router::new()
            .route("/test", get(dummy_handler))
            .layer(axum_mw::from_fn_with_state(state.clone(), auth_middleware))
            .with_state(state)
    }

    #[tokio::test]
    async fn test_auth_middleware_test_mode() {
        // Set STT_TEST_MODE so the middleware bypasses real auth.
        unsafe { std::env::set_var("STT_TEST_MODE", "1") };

        let app = build_test_app(create_test_state());

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/test")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        // Clean up.
        unsafe { std::env::remove_var("STT_TEST_MODE") };
    }

    #[tokio::test]
    async fn test_auth_middleware_missing_header() {
        // Ensure test mode is off.
        unsafe { std::env::remove_var("STT_TEST_MODE") };

        let app = build_test_app(create_test_state());

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/test")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_auth_middleware_invalid_header_format() {
        // Ensure test mode is off.
        unsafe { std::env::remove_var("STT_TEST_MODE") };

        let app = build_test_app(create_test_state());

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/test")
                    .header("Authorization", "Basic abc")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    // ── validate_ws_token tests ─────────────────────────────────────

    #[tokio::test]
    async fn test_validate_ws_token_test_mode() {
        unsafe { std::env::set_var("STT_TEST_MODE", "1") };

        let state = create_test_state();
        let result = validate_ws_token(&state, "any_token_value").await;

        assert!(result.is_ok());
        let user = result.unwrap();
        assert_eq!(user.username, "test_user");

        unsafe { std::env::remove_var("STT_TEST_MODE") };
    }
}
