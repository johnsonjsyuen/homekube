package com.homekube.location

import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import org.jooq.DSLContext
import org.jooq.impl.DSL.*
import org.jooq.impl.SQLDataType
import java.time.OffsetDateTime
import java.util.UUID

@ApplicationScoped
class MemberRepository {

    @Inject
    lateinit var dsl: DSLContext

    companion object {
        val FAMILY_GROUPS = table("family_groups")
        val FG_ID = field(name("family_groups", "id"), SQLDataType.UUID)
        val FG_NAME = field(name("family_groups", "name"), SQLDataType.VARCHAR)

        val MEMBERS = table("members")
        val M_ID = field(name("members", "id"), SQLDataType.VARCHAR)
        val M_FAMILY_GROUP_ID = field(name("members", "family_group_id"), SQLDataType.UUID)
        val M_DISPLAY_NAME = field(name("members", "display_name"), SQLDataType.VARCHAR)
        val M_AVATAR_URL = field(name("members", "avatar_url"), SQLDataType.VARCHAR)
        val M_ROLE = field(name("members", "role"), SQLDataType.VARCHAR)
        val M_CREATED_AT = field(name("members", "created_at"), SQLDataType.TIMESTAMPWITHTIMEZONE)
        val M_UPDATED_AT = field(name("members", "updated_at"), SQLDataType.TIMESTAMPWITHTIMEZONE)
    }

    fun getDefaultFamilyGroupId(): UUID =
        dsl.select(FG_ID).from(FAMILY_GROUPS)
            .orderBy(field(name("family_groups", "created_at"), SQLDataType.TIMESTAMPWITHTIMEZONE).asc())
            .limit(1)
            .fetchOne(FG_ID)!!

    fun findById(id: String): MemberRow? =
        dsl.select(M_ID, M_FAMILY_GROUP_ID, M_DISPLAY_NAME, M_AVATAR_URL, M_ROLE)
            .from(MEMBERS)
            .where(M_ID.eq(id))
            .fetchOne()?.let { r ->
                MemberRow(
                    id = r.get(M_ID)!!,
                    familyGroupId = r.get(M_FAMILY_GROUP_ID)!!,
                    displayName = r.get(M_DISPLAY_NAME) ?: "",
                    avatarUrl = r.get(M_AVATAR_URL),
                    role = r.get(M_ROLE) ?: "member",
                )
            }

    fun findByFamilyGroupId(familyGroupId: UUID): List<FamilyMember> =
        dsl.select(M_ID, M_DISPLAY_NAME, M_AVATAR_URL, M_ROLE)
            .from(MEMBERS)
            .where(M_FAMILY_GROUP_ID.eq(familyGroupId))
            .orderBy(M_DISPLAY_NAME.asc())
            .fetch().map { r ->
                FamilyMember(
                    id = r.get(M_ID)!!,
                    displayName = r.get(M_DISPLAY_NAME) ?: "",
                    avatarUrl = r.get(M_AVATAR_URL),
                    role = r.get(M_ROLE) ?: "member",
                )
            }

    fun getFamilyGroup(familyGroupId: UUID): FamilyGroup? {
        val group = dsl.select(FG_ID, FG_NAME)
            .from(FAMILY_GROUPS)
            .where(FG_ID.eq(familyGroupId))
            .fetchOne() ?: return null

        val members = findByFamilyGroupId(familyGroupId)

        return FamilyGroup(
            id = group.get(FG_ID)!!.toString(),
            name = group.get(FG_NAME) ?: "",
            members = members,
        )
    }

    fun insert(id: String, familyGroupId: UUID, displayName: String, role: String = "member") {
        dsl.insertInto(MEMBERS)
            .set(M_ID, id)
            .set(M_FAMILY_GROUP_ID, familyGroupId)
            .set(M_DISPLAY_NAME, displayName)
            .set(M_ROLE, role)
            .set(M_CREATED_AT, OffsetDateTime.now())
            .set(M_UPDATED_AT, OffsetDateTime.now())
            .execute()
    }

    fun ensureMember(userId: String, displayName: String): MemberRow {
        val existing = findById(userId)
        if (existing != null) return existing

        val familyGroupId = getDefaultFamilyGroupId()
        insert(userId, familyGroupId, displayName)
        return MemberRow(
            id = userId,
            familyGroupId = familyGroupId,
            displayName = displayName,
            avatarUrl = null,
            role = "member",
        )
    }
}

data class MemberRow(
    val id: String,
    val familyGroupId: UUID,
    val displayName: String,
    val avatarUrl: String?,
    val role: String,
)
