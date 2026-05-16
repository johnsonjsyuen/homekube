package com.homekube.location

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import org.jooq.DSLContext
import org.jooq.impl.DSL.*
import org.jooq.impl.SQLDataType
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID

@ApplicationScoped
class LocationRepository {

    @Inject
    lateinit var dsl: DSLContext

    companion object {
        val LOCATIONS = table("locations")
        val L_ID = field(name("locations", "id"), SQLDataType.BIGINT)
        val L_MEMBER_ID = field(name("locations", "member_id"), SQLDataType.VARCHAR)
        val L_LAT = field(name("locations", "lat"), SQLDataType.DOUBLE)
        val L_LNG = field(name("locations", "lng"), SQLDataType.DOUBLE)
        val L_ACCURACY = field(name("locations", "accuracy"), SQLDataType.DOUBLE)
        val L_ALTITUDE = field(name("locations", "altitude"), SQLDataType.DOUBLE)
        val L_SPEED = field(name("locations", "speed"), SQLDataType.DOUBLE)
        val L_BEARING = field(name("locations", "bearing"), SQLDataType.DOUBLE)
        val L_BATTERY = field(name("locations", "battery"), SQLDataType.INTEGER)
        val L_TIMESTAMP = field(name("locations", "timestamp"), SQLDataType.TIMESTAMPWITHTIMEZONE)
    }

    fun insertBatch(memberId: String, reports: List<LocationReport>) {
        if (reports.isEmpty()) return
        dsl.transaction { config ->
            val tx = config.dsl()
            reports.forEach { r ->
                tx.insertInto(LOCATIONS)
                    .set(L_MEMBER_ID, memberId)
                    .set(L_LAT, r.lat)
                    .set(L_LNG, r.lng)
                    .set(L_ACCURACY, r.accuracy)
                    .set(L_ALTITUDE, r.altitude)
                    .set(L_SPEED, r.speed)
                    .set(L_BEARING, r.bearing)
                    .set(L_BATTERY, r.battery)
                    .set(L_TIMESTAMP, OffsetDateTime.parse(r.timestamp))
                    .execute()
            }
        }
    }

    fun getLatestPerMember(familyGroupId: UUID): List<MemberLocation> {
        return dsl.fetch(
            """
            SELECT DISTINCT ON (l.member_id)
                l.member_id, m.display_name, m.avatar_url,
                l.lat, l.lng, l.accuracy, l.altitude, l.speed, l.bearing, l.battery,
                l.timestamp,
                (l.timestamp > NOW() - INTERVAL '5 minutes') AS is_online
            FROM locations l
            JOIN members m ON l.member_id = m.id
            WHERE m.family_group_id = CAST(? AS uuid)
            ORDER BY l.member_id, l.timestamp DESC
            """,
            familyGroupId.toString(),
        ).map { r ->
            val ts = r.get("timestamp", OffsetDateTime::class.java)
            MemberLocation(
                memberId = r.get("member_id", String::class.java) ?: "",
                displayName = r.get("display_name", String::class.java) ?: "",
                avatarUrl = r.get("avatar_url", String::class.java),
                lat = r.get("lat", Double::class.java) ?: 0.0,
                lng = r.get("lng", Double::class.java) ?: 0.0,
                accuracy = r.get("accuracy", Double::class.java) ?: 0.0,
                altitude = r.get("altitude", Double::class.java),
                speed = r.get("speed", Double::class.java),
                bearing = r.get("bearing", Double::class.java),
                battery = r.get("battery", Int::class.java),
                timestamp = ts?.toInstant()?.toString() ?: "",
                isOnline = r.get("is_online", Boolean::class.java) ?: false,
            )
        }
    }

    fun getHistory(memberId: String, familyGroupId: UUID, date: String): List<HistoryPoint> {
        val localDate = LocalDate.parse(date)
        val dayStart = localDate.atStartOfDay().atOffset(ZoneOffset.UTC)
        val dayEnd = localDate.plusDays(1).atStartOfDay().atOffset(ZoneOffset.UTC)

        return dsl.fetch(
            """
            SELECT l.lat, l.lng, l.accuracy, l.speed, l.timestamp
            FROM locations l
            JOIN members m ON l.member_id = m.id
            WHERE l.member_id = ? AND m.family_group_id = CAST(? AS uuid)
              AND l.timestamp >= CAST(? AS timestamptz) AND l.timestamp < CAST(? AS timestamptz)
            ORDER BY l.timestamp ASC
            """,
            memberId, familyGroupId, dayStart.toString(), dayEnd.toString(),
        ).map { r ->
            val ts = r.get("timestamp", OffsetDateTime::class.java)
            HistoryPoint(
                lat = r.get("lat", Double::class.java) ?: 0.0,
                lng = r.get("lng", Double::class.java) ?: 0.0,
                accuracy = r.get("accuracy", Double::class.java) ?: 0.0,
                speed = r.get("speed", Double::class.java),
                timestamp = ts?.toInstant()?.toString() ?: "",
            )
        }
    }
}
