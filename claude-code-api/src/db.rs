use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Model types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Conversation {
    pub id: Uuid,
    pub user_id: String,
    pub title: String,
    pub session_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Message {
    pub id: Uuid,
    pub conversation_id: Uuid,
    pub role: String,
    pub content: String,
    pub created_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Conversation queries
// ---------------------------------------------------------------------------

pub async fn create_conversation(
    pool: &PgPool,
    user_id: &str,
    title: &str,
) -> Result<Conversation, sqlx::Error> {
    sqlx::query_as::<_, Conversation>(
        "INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING *",
    )
    .bind(user_id)
    .bind(title)
    .fetch_one(pool)
    .await
}

pub async fn list_conversations(
    pool: &PgPool,
    user_id: &str,
) -> Result<Vec<Conversation>, sqlx::Error> {
    sqlx::query_as::<_, Conversation>(
        "SELECT * FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn get_conversation(
    pool: &PgPool,
    id: Uuid,
    user_id: &str,
) -> Result<Option<Conversation>, sqlx::Error> {
    sqlx::query_as::<_, Conversation>(
        "SELECT * FROM conversations WHERE id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn update_session_id(
    pool: &PgPool,
    id: Uuid,
    session_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE conversations SET session_id = $1, updated_at = now() WHERE id = $2")
        .bind(session_id)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

#[allow(dead_code)]
pub async fn update_conversation_title(
    pool: &PgPool,
    id: Uuid,
    title: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE conversations SET title = $1, updated_at = now() WHERE id = $2")
        .bind(title)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_conversation(
    pool: &PgPool,
    id: Uuid,
    user_id: &str,
) -> Result<bool, sqlx::Error> {
    let result =
        sqlx::query("DELETE FROM conversations WHERE id = $1 AND user_id = $2")
            .bind(id)
            .bind(user_id)
            .execute(pool)
            .await?;
    Ok(result.rows_affected() > 0)
}

// ---------------------------------------------------------------------------
// Message queries
// ---------------------------------------------------------------------------

pub async fn insert_message(
    pool: &PgPool,
    conversation_id: Uuid,
    role: &str,
    content: &str,
) -> Result<Message, sqlx::Error> {
    // Also bump the conversation's updated_at timestamp.
    sqlx::query("UPDATE conversations SET updated_at = now() WHERE id = $1")
        .bind(conversation_id)
        .execute(pool)
        .await?;

    sqlx::query_as::<_, Message>(
        "INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3) RETURNING *",
    )
    .bind(conversation_id)
    .bind(role)
    .bind(content)
    .fetch_one(pool)
    .await
}

pub async fn get_messages(
    pool: &PgPool,
    conversation_id: Uuid,
) -> Result<Vec<Message>, sqlx::Error> {
    sqlx::query_as::<_, Message>(
        "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC",
    )
    .bind(conversation_id)
    .fetch_all(pool)
    .await
}
