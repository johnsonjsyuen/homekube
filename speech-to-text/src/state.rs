use jsonwebtoken::DecodingKey;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct AppState {
    pub jwks_cache: Arc<RwLock<JwksCache>>,
    pub keycloak_url: String,
    pub keycloak_realm: String,
    pub keycloak_audience: String,
    pub whisper_url: String,
}

#[derive(Default)]
pub struct JwksCache {
    pub keys: HashMap<String, DecodingKey>,
    pub last_fetched: Option<std::time::Instant>,
}
