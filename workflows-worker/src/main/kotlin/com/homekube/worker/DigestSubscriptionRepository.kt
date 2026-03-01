package com.homekube.worker

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import org.jooq.DSLContext
import org.jooq.impl.DSL.*
import org.jooq.impl.SQLDataType
import java.time.OffsetDateTime

@ApplicationScoped
class DigestSubscriptionRepository {

    @Inject
    lateinit var dsl: DSLContext

    companion object {
        val DIGEST_SUBSCRIPTIONS = table("digest_subscriptions")
        val USER_ID = field("user_id", SQLDataType.VARCHAR)
        val DIGEST_TYPE = field("digest_type", SQLDataType.VARCHAR)
        val SUBSCRIBED = field("subscribed", SQLDataType.BOOLEAN)
        val SUBSCRIBED_AT = field("subscribed_at", SQLDataType.TIMESTAMPWITHTIMEZONE)
        val UPDATED_AT = field("updated_at", SQLDataType.TIMESTAMPWITHTIMEZONE)
    }

    fun findActiveUserIdsByType(digestType: String): List<String> =
        dsl.select(USER_ID).from(DIGEST_SUBSCRIPTIONS)
            .where(DIGEST_TYPE.eq(digestType).and(SUBSCRIBED.isTrue))
            .fetch(USER_ID)

    fun isSubscribed(userId: String, digestType: String): Boolean =
        dsl.select(SUBSCRIBED).from(DIGEST_SUBSCRIPTIONS)
            .where(USER_ID.eq(userId).and(DIGEST_TYPE.eq(digestType)))
            .fetchOne(SUBSCRIBED) ?: false

    fun upsert(userId: String, digestType: String, subscribed: Boolean) {
        // PostgreSQL upsert
        dsl.query(
            """
            INSERT INTO digest_subscriptions (user_id, digest_type, subscribed, subscribed_at, updated_at)
            VALUES (?, ?, ?, NOW(), NOW())
            ON CONFLICT (user_id, digest_type)
            DO UPDATE SET subscribed = ?, updated_at = NOW()
            """.trimIndent(),
            userId, digestType, subscribed, subscribed
        ).execute()
    }
}
