use jsonwebtoken::DecodingKey;
use sqlx::{Pool, Postgres};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct AppState {
    pub pool: Pool<Postgres>,
    pub storage_path: String,
    pub jwks_cache: Arc<RwLock<JwksCache>>,
    pub keycloak_url: String,
    pub keycloak_realm: String,
    pub keycloak_audience: String,
}

#[derive(Default)]
pub struct JwksCache {
    pub keys: HashMap<String, DecodingKey>,
    pub last_fetched: Option<std::time::Instant>,
}
