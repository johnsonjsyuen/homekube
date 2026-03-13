package com.homekube.location

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import org.jooq.DSLContext
import org.jooq.impl.DSL.*
import org.jooq.impl.SQLDataType
import java.time.OffsetDateTime
import java.util.UUID

@ApplicationScoped
class PlaceRepository {

    @Inject
    lateinit var dsl: DSLContext

    companion object {
        val PLACES = table("places")
        val P_ID = field(name("places", "id"), SQLDataType.UUID)
        val P_FAMILY_GROUP_ID = field(name("places", "family_group_id"), SQLDataType.UUID)
        val P_NAME = field(name("places", "name"), SQLDataType.VARCHAR)
        val P_LAT = field(name("places", "lat"), SQLDataType.DOUBLE)
        val P_LNG = field(name("places", "lng"), SQLDataType.DOUBLE)
        val P_RADIUS_METERS = field(name("places", "radius_meters"), SQLDataType.DOUBLE)
        val P_ICON = field(name("places", "icon"), SQLDataType.VARCHAR)
        val P_CREATED_BY = field(name("places", "created_by"), SQLDataType.VARCHAR)
        val P_CREATED_AT = field(name("places", "created_at"), SQLDataType.TIMESTAMPWITHTIMEZONE)
        val P_UPDATED_AT = field(name("places", "updated_at"), SQLDataType.TIMESTAMPWITHTIMEZONE)
    }

    private fun mapToPlace(r: org.jooq.Record): Place {
        val createdAt = r.get(P_CREATED_AT) as? OffsetDateTime
        return Place(
            id = r.get(P_ID)?.toString() ?: "",
            name = r.get(P_NAME) ?: "",
            lat = r.get(P_LAT) ?: 0.0,
            lng = r.get(P_LNG) ?: 0.0,
            radiusMeters = r.get(P_RADIUS_METERS) ?: 0.0,
            icon = r.get(P_ICON) ?: "",
            createdBy = r.get(P_CREATED_BY) ?: "",
            createdAt = createdAt?.toInstant()?.toString() ?: "",
        )
    }

    fun findByFamilyGroupId(familyGroupId: UUID): List<Place> =
        dsl.select(P_ID, P_NAME, P_LAT, P_LNG, P_RADIUS_METERS, P_ICON, P_CREATED_BY, P_CREATED_AT)
            .from(PLACES)
            .where(P_FAMILY_GROUP_ID.eq(familyGroupId))
            .orderBy(P_NAME.asc())
            .fetch()
            .map(::mapToPlace)

    fun findByIdAndFamilyGroupId(id: UUID, familyGroupId: UUID): Place? =
        dsl.select(P_ID, P_NAME, P_LAT, P_LNG, P_RADIUS_METERS, P_ICON, P_CREATED_BY, P_CREATED_AT)
            .from(PLACES)
            .where(P_ID.eq(id).and(P_FAMILY_GROUP_ID.eq(familyGroupId)))
            .fetchOne()
            ?.let(::mapToPlace)

    fun insert(familyGroupId: UUID, createdBy: String, body: PlaceCreate): Place {
        val id = UUID.randomUUID()
        val now = OffsetDateTime.now()
        dsl.insertInto(PLACES)
            .set(P_ID, id)
            .set(P_FAMILY_GROUP_ID, familyGroupId)
            .set(P_NAME, body.name)
            .set(P_LAT, body.lat)
            .set(P_LNG, body.lng)
            .set(P_RADIUS_METERS, body.radiusMeters)
            .set(P_ICON, body.icon)
            .set(P_CREATED_BY, createdBy)
            .set(P_CREATED_AT, now)
            .set(P_UPDATED_AT, now)
            .execute()

        return Place(
            id = id.toString(),
            name = body.name,
            lat = body.lat,
            lng = body.lng,
            radiusMeters = body.radiusMeters,
            icon = body.icon,
            createdBy = createdBy,
            createdAt = now.toInstant().toString(),
        )
    }

    fun update(id: UUID, familyGroupId: UUID, body: PlaceUpdate): Int {
        val update = dsl.update(PLACES)
            .set(P_UPDATED_AT, OffsetDateTime.now())

        body.name?.let { update.set(P_NAME, it) }
        body.lat?.let { update.set(P_LAT, it) }
        body.lng?.let { update.set(P_LNG, it) }
        body.radiusMeters?.let { update.set(P_RADIUS_METERS, it) }
        body.icon?.let { update.set(P_ICON, it) }

        return update
            .where(P_ID.eq(id).and(P_FAMILY_GROUP_ID.eq(familyGroupId)))
            .execute()
    }

    fun delete(id: UUID, familyGroupId: UUID): Int =
        dsl.deleteFrom(PLACES)
            .where(P_ID.eq(id).and(P_FAMILY_GROUP_ID.eq(familyGroupId)))
            .execute()
}
