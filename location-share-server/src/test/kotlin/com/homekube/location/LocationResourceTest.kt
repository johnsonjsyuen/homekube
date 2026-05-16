package com.homekube.location

import io.quarkus.test.junit.QuarkusTest
import io.quarkus.test.security.TestSecurity
import io.quarkus.test.security.jwt.Claim
import io.quarkus.test.security.jwt.JwtSecurity
import io.restassured.RestAssured.given
import io.restassured.http.ContentType
import jakarta.inject.Inject
import org.hamcrest.CoreMatchers.`is`
import org.hamcrest.CoreMatchers.notNullValue
import org.hamcrest.Matchers.equalTo
import org.hamcrest.Matchers.greaterThanOrEqualTo
import org.hamcrest.Matchers.hasSize
import org.jooq.DSLContext
import org.jooq.impl.DSL.field
import org.jooq.impl.DSL.name
import org.jooq.impl.DSL.table
import org.jooq.impl.SQLDataType
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.OffsetDateTime
import java.time.ZoneOffset

@QuarkusTest
class LocationResourceTest {

    @Inject
    lateinit var dsl: DSLContext

    companion object {
        const val USER_A_ID = "user-a-uuid"
        const val USER_A_NAME = "Alice"
        const val USER_B_ID = "user-b-uuid"
        const val USER_B_NAME = "Bob"
    }

    @BeforeEach
    fun cleanup() {
        dsl.deleteFrom(table("locations")).execute()
        dsl.deleteFrom(table("places")).execute()
        dsl.deleteFrom(table("members")).execute()
    }

    // ========================== TC-001: reportLocations ==========================

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `TC-001 reportLocations inserts all reports`() {
        val now = OffsetDateTime.now(ZoneOffset.UTC)
        val reports = (1..5).map { i ->
            mapOf(
                "lat" to -37.8 + i * 0.001,
                "lng" to 144.9 + i * 0.001,
                "accuracy" to 10.0,
                "timestamp" to now.minusMinutes(i.toLong()).toString(),
            )
        }

        given()
            .contentType(ContentType.JSON)
            .body(reports)
            .`when`().post("/api/locations")
            .then()
            .statusCode(204)

        val count = dsl.fetchCount(table("locations"))
        assert(count == 5) { "Expected 5 rows, got $count" }
    }

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `TC-001 reportLocations with empty array returns 204`() {
        given()
            .contentType(ContentType.JSON)
            .body(emptyList<Any>())
            .`when`().post("/api/locations")
            .then()
            .statusCode(204)
    }

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `TC-001 reportLocations rejects batch over 100`() {
        val now = OffsetDateTime.now(ZoneOffset.UTC)
        val reports = (1..101).map { i ->
            mapOf(
                "lat" to -37.8,
                "lng" to 144.9,
                "accuracy" to 10.0,
                "timestamp" to now.minusSeconds(i.toLong()).toString(),
            )
        }

        given()
            .contentType(ContentType.JSON)
            .body(reports)
            .`when`().post("/api/locations")
            .then()
            .statusCode(400)
            .body("error", equalTo("Maximum 100 locations per batch"))
    }

    // ========================== TC-002: getFamilyLocations ==========================

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `TC-002 getFamilyLocations returns latest per member`() {
        // Seed members in the default family group
        val familyGroupId = dsl.select(field("id", SQLDataType.UUID))
            .from(table("family_groups"))
            .limit(1)
            .fetchOne()!!
            .get(field("id", SQLDataType.UUID))!!

        val now = OffsetDateTime.now(ZoneOffset.UTC)

        // Insert 3 members
        listOf(
            Triple(USER_A_ID, USER_A_NAME, "member"),
            Triple(USER_B_ID, USER_B_NAME, "member"),
            Triple("user-c-uuid", "Charlie", "member"),
        ).forEach { (id, name, role) ->
            dsl.insertInto(table("members"))
                .set(field("id", SQLDataType.VARCHAR), id)
                .set(field("family_group_id", SQLDataType.UUID), familyGroupId)
                .set(field("display_name", SQLDataType.VARCHAR), name)
                .set(field("role", SQLDataType.VARCHAR), role)
                .set(field("created_at", SQLDataType.TIMESTAMPWITHTIMEZONE), now)
                .set(field("updated_at", SQLDataType.TIMESTAMPWITHTIMEZONE), now)
                .execute()
        }

        // Insert multiple locations per member (3 each)
        listOf(USER_A_ID, USER_B_ID, "user-c-uuid").forEach { memberId ->
            for (i in 1..3) {
                dsl.insertInto(table("locations"))
                    .set(field("member_id", SQLDataType.VARCHAR), memberId)
                    .set(field("lat", SQLDataType.DOUBLE), -37.8)
                    .set(field("lng", SQLDataType.DOUBLE), 144.9)
                    .set(field("accuracy", SQLDataType.DOUBLE), 10.0)
                    .set(field("timestamp", SQLDataType.TIMESTAMPWITHTIMEZONE), now.minusMinutes(i.toLong()))
                    .execute()
            }
        }

        given()
            .`when`().get("/api/family/locations")
            .then()
            .statusCode(200)
            .body("", hasSize<Any>(3))
    }

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `TC-002 getFamilyLocations with no locations returns empty`() {
        given()
            .`when`().get("/api/family/locations")
            .then()
            .statusCode(200)
            .body("", hasSize<Any>(0))
    }

    // ========================== TC-003: getLocationHistory ==========================

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `TC-003 getLocationHistory returns points ordered by timestamp`() {
        val familyGroupId = seedMemberAndGetFamily(USER_A_ID, USER_A_NAME)
        val date = "2026-03-08"
        val baseTime = OffsetDateTime.of(2026, 3, 8, 10, 0, 0, 0, ZoneOffset.UTC)

        // Insert 50 points throughout the day
        for (i in 0 until 50) {
            dsl.insertInto(table("locations"))
                .set(field("member_id", SQLDataType.VARCHAR), USER_A_ID)
                .set(field("lat", SQLDataType.DOUBLE), -37.8 + i * 0.0001)
                .set(field("lng", SQLDataType.DOUBLE), 144.9 + i * 0.0001)
                .set(field("accuracy", SQLDataType.DOUBLE), 10.0)
                .set(field("speed", SQLDataType.DOUBLE), 1.5)
                .set(field("timestamp", SQLDataType.TIMESTAMPWITHTIMEZONE), baseTime.plusMinutes(i.toLong()))
                .execute()
        }

        given()
            .queryParam("memberId", USER_A_ID)
            .queryParam("date", date)
            .`when`().get("/api/locations/history")
            .then()
            .statusCode(200)
            .body("", hasSize<Any>(50))
            .body("[0].lat", notNullValue())
            .body("[0].accuracy", notNullValue())
    }

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `TC-003 getLocationHistory with no points returns empty`() {
        // ensureMember will auto-provision
        given()
            .queryParam("memberId", USER_A_ID)
            .queryParam("date", "2020-01-01")
            .`when`().get("/api/locations/history")
            .then()
            .statusCode(200)
            .body("", hasSize<Any>(0))
    }

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `TC-003 getLocationHistory missing params returns 400`() {
        given()
            .`when`().get("/api/locations/history")
            .then()
            .statusCode(400)
    }

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `TC-003 getLocationHistory invalid date returns 400`() {
        given()
            .queryParam("memberId", USER_A_ID)
            .queryParam("date", "not-a-date")
            .`when`().get("/api/locations/history")
            .then()
            .statusCode(400)
    }

    // ========================== TC-004: createPlace ==========================

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `TC-004 createPlace returns place with generated id`() {
        given()
            .contentType(ContentType.JSON)
            .body(mapOf(
                "name" to "Home",
                "lat" to -37.8136,
                "lng" to 144.9631,
                "radiusMeters" to 100.0,
                "icon" to "\uD83C\uDFE0",
            ))
            .`when`().post("/api/places")
            .then()
            .statusCode(201)
            .body("id", notNullValue())
            .body("name", equalTo("Home"))
            .body("createdBy", equalTo(USER_A_ID))
    }

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `TC-004 createPlace rejects invalid radius`() {
        given()
            .contentType(ContentType.JSON)
            .body(mapOf(
                "name" to "Too Small",
                "lat" to -37.8,
                "lng" to 144.9,
                "radiusMeters" to 10.0,
                "icon" to "\uD83D\uDCCD",
            ))
            .`when`().post("/api/places")
            .then()
            .statusCode(400)
            .body("error", equalTo("radiusMeters must be between 50 and 2000"))

        given()
            .contentType(ContentType.JSON)
            .body(mapOf(
                "name" to "Too Big",
                "lat" to -37.8,
                "lng" to 144.9,
                "radiusMeters" to 5000.0,
                "icon" to "\uD83D\uDCCD",
            ))
            .`when`().post("/api/places")
            .then()
            .statusCode(400)
    }

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `TC-004 createPlace rejects invalid coordinates`() {
        given()
            .contentType(ContentType.JSON)
            .body(mapOf(
                "name" to "Bad coords",
                "lat" to 91.0,
                "lng" to 144.9,
                "radiusMeters" to 100.0,
                "icon" to "\uD83D\uDCCD",
            ))
            .`when`().post("/api/places")
            .then()
            .statusCode(400)
    }

    // ========================== TC-005: updatePlace ==========================

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `TC-005 updatePlace partial update only changes specified fields`() {
        // Create a place first
        val placeId = given()
            .contentType(ContentType.JSON)
            .body(mapOf(
                "name" to "Original",
                "lat" to -37.8,
                "lng" to 144.9,
                "radiusMeters" to 200.0,
                "icon" to "\uD83D\uDCCD",
            ))
            .`when`().post("/api/places")
            .then()
            .statusCode(201)
            .extract().path<String>("id")

        // Update only the name
        given()
            .contentType(ContentType.JSON)
            .body(mapOf("name" to "Updated"))
            .`when`().put("/api/places/$placeId")
            .then()
            .statusCode(200)
            .body("name", equalTo("Updated"))
            .body("lat", equalTo(-37.8f))
            .body("lng", equalTo(144.9f))
            .body("radiusMeters", equalTo(200.0f))
    }

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `TC-005 updatePlace not found returns 404`() {
        given()
            .contentType(ContentType.JSON)
            .body(mapOf("name" to "Nope"))
            .`when`().put("/api/places/00000000-0000-0000-0000-000000000000")
            .then()
            .statusCode(404)
    }

    // ========================== TC-006: Auto-provisioning ==========================

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `TC-006 auto-provisioning creates member on first call`() {
        // No member exists yet — first API call should auto-provision
        given()
            .`when`().get("/api/family")
            .then()
            .statusCode(200)
            .body("members", hasSize<Any>(greaterThanOrEqualTo(1)))

        // Verify member row exists
        val count = dsl.fetchCount(
            table("members"),
            field("id", SQLDataType.VARCHAR).eq(USER_A_ID),
        )
        assert(count == 1) { "Expected member to be auto-provisioned" }
    }

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `TC-006 auto-provisioning is idempotent`() {
        // Two calls should not create duplicate members
        given().`when`().get("/api/family").then().statusCode(200)
        given().`when`().get("/api/family").then().statusCode(200)

        val count = dsl.fetchCount(
            table("members"),
            field("id", SQLDataType.VARCHAR).eq(USER_A_ID),
        )
        assert(count == 1) { "Expected exactly 1 member, got $count" }
    }

    // ========================== TC-007: isOnline derivation ==========================

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `TC-007 isOnline true when location within 5 minutes`() {
        val familyGroupId = seedMemberAndGetFamily(USER_A_ID, USER_A_NAME)
        val now = OffsetDateTime.now(ZoneOffset.UTC)

        dsl.insertInto(table("locations"))
            .set(field("member_id", SQLDataType.VARCHAR), USER_A_ID)
            .set(field("lat", SQLDataType.DOUBLE), -37.8)
            .set(field("lng", SQLDataType.DOUBLE), 144.9)
            .set(field("accuracy", SQLDataType.DOUBLE), 10.0)
            .set(field("timestamp", SQLDataType.TIMESTAMPWITHTIMEZONE), now.minusMinutes(3))
            .execute()

        given()
            .`when`().get("/api/family/locations")
            .then()
            .statusCode(200)
            .body("[0].isOnline", `is`(true))
    }

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `TC-007 isOnline false when location older than 5 minutes`() {
        val familyGroupId = seedMemberAndGetFamily(USER_A_ID, USER_A_NAME)
        val now = OffsetDateTime.now(ZoneOffset.UTC)

        dsl.insertInto(table("locations"))
            .set(field("member_id", SQLDataType.VARCHAR), USER_A_ID)
            .set(field("lat", SQLDataType.DOUBLE), -37.8)
            .set(field("lng", SQLDataType.DOUBLE), 144.9)
            .set(field("accuracy", SQLDataType.DOUBLE), 10.0)
            .set(field("timestamp", SQLDataType.TIMESTAMPWITHTIMEZONE), now.minusMinutes(10))
            .execute()

        given()
            .`when`().get("/api/family/locations")
            .then()
            .statusCode(200)
            .body("[0].isOnline", `is`(false))
    }

    // ========================== IT-001: Report + fetch flow ==========================

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `IT-001 report then fetch returns reported location`() {
        val now = OffsetDateTime.now(ZoneOffset.UTC)
        val reports = listOf(mapOf(
            "lat" to -37.8136,
            "lng" to 144.9631,
            "accuracy" to 5.0,
            "timestamp" to now.toString(),
        ))

        given()
            .contentType(ContentType.JSON)
            .body(reports)
            .`when`().post("/api/locations")
            .then()
            .statusCode(204)

        given()
            .`when`().get("/api/family/locations")
            .then()
            .statusCode(200)
            .body("", hasSize<Any>(1))
            .body("[0].memberId", equalTo(USER_A_ID))
            .body("[0].displayName", equalTo(USER_A_NAME))
    }

    // ========================== IT-002: Family scoping ==========================

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `IT-002 user sees other family members locations`() {
        val familyGroupId = seedMemberAndGetFamily(USER_A_ID, USER_A_NAME)
        val now = OffsetDateTime.now(ZoneOffset.UTC)

        // Seed user B in same family
        dsl.insertInto(table("members"))
            .set(field("id", SQLDataType.VARCHAR), USER_B_ID)
            .set(field("family_group_id", SQLDataType.UUID), familyGroupId)
            .set(field("display_name", SQLDataType.VARCHAR), USER_B_NAME)
            .set(field("role", SQLDataType.VARCHAR), "member")
            .set(field("created_at", SQLDataType.TIMESTAMPWITHTIMEZONE), now)
            .set(field("updated_at", SQLDataType.TIMESTAMPWITHTIMEZONE), now)
            .execute()

        // Insert location for user B
        dsl.insertInto(table("locations"))
            .set(field("member_id", SQLDataType.VARCHAR), USER_B_ID)
            .set(field("lat", SQLDataType.DOUBLE), -37.82)
            .set(field("lng", SQLDataType.DOUBLE), 144.97)
            .set(field("accuracy", SQLDataType.DOUBLE), 10.0)
            .set(field("timestamp", SQLDataType.TIMESTAMPWITHTIMEZONE), now)
            .execute()

        given()
            .`when`().get("/api/family/locations")
            .then()
            .statusCode(200)
            .body("", hasSize<Any>(1))
            .body("[0].memberId", equalTo(USER_B_ID))
    }

    // ========================== IT-003: Place CRUD cycle ==========================

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `IT-003 full place CRUD cycle`() {
        // Create
        val placeId = given()
            .contentType(ContentType.JSON)
            .body(mapOf(
                "name" to "School",
                "lat" to -37.82,
                "lng" to 144.97,
                "radiusMeters" to 150.0,
                "icon" to "\uD83C\uDFEB",
            ))
            .`when`().post("/api/places")
            .then()
            .statusCode(201)
            .body("name", equalTo("School"))
            .extract().path<String>("id")

        // Read
        given()
            .`when`().get("/api/places")
            .then()
            .statusCode(200)
            .body("", hasSize<Any>(1))
            .body("[0].id", equalTo(placeId))

        // Update
        given()
            .contentType(ContentType.JSON)
            .body(mapOf("name" to "High School", "radiusMeters" to 300.0))
            .`when`().put("/api/places/$placeId")
            .then()
            .statusCode(200)
            .body("name", equalTo("High School"))
            .body("radiusMeters", equalTo(300.0f))

        // Delete
        given()
            .`when`().delete("/api/places/$placeId")
            .then()
            .statusCode(204)

        // Verify deleted
        given()
            .`when`().get("/api/places")
            .then()
            .statusCode(200)
            .body("", hasSize<Any>(0))
    }

    // ========================== Additional: memberId override ==========================

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `reportLocations overrides memberId with JWT sub`() {
        val now = OffsetDateTime.now(ZoneOffset.UTC)
        val reports = listOf(mapOf(
            "memberId" to "spoofed-id",
            "lat" to -37.8,
            "lng" to 144.9,
            "accuracy" to 10.0,
            "timestamp" to now.toString(),
        ))

        given()
            .contentType(ContentType.JSON)
            .body(reports)
            .`when`().post("/api/locations")
            .then()
            .statusCode(204)

        // Verify it was stored under the real user ID, not the spoofed one
        val storedMemberId = dsl.select(field("member_id", SQLDataType.VARCHAR))
            .from(table("locations"))
            .fetchOne()!!
            .get(field("member_id", SQLDataType.VARCHAR))

        assert(storedMemberId == USER_A_ID) { "Expected $USER_A_ID but got $storedMemberId" }
    }

    // ========================== Additional: invalid timestamp ==========================

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `reportLocations with invalid timestamp returns 400`() {
        val reports = listOf(mapOf(
            "lat" to -37.8,
            "lng" to 144.9,
            "accuracy" to 10.0,
            "timestamp" to "not-a-timestamp",
        ))

        given()
            .contentType(ContentType.JSON)
            .body(reports)
            .`when`().post("/api/locations")
            .then()
            .statusCode(400)
            .body("error", equalTo("Invalid timestamp format, expected ISO 8601"))
    }

    // ========================== Additional: delete non-existent place ==========================

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `deletePlace not found returns 404`() {
        given()
            .`when`().delete("/api/places/00000000-0000-0000-0000-000000000000")
            .then()
            .statusCode(404)
    }

    // ========================== Additional: invalid coordinates in reportLocations ==========================

    @Test
    @TestSecurity(user = USER_A_ID, roles = ["user"])
    @JwtSecurity(claims = [
        Claim(key = "sub", value = USER_A_ID),
        Claim(key = "name", value = USER_A_NAME),
    ])
    fun `reportLocations rejects invalid coordinates`() {
        val now = OffsetDateTime.now(ZoneOffset.UTC)
        val reports = listOf(mapOf(
            "lat" to 91.0,
            "lng" to 144.9,
            "accuracy" to 10.0,
            "timestamp" to now.toString(),
        ))

        given()
            .contentType(ContentType.JSON)
            .body(reports)
            .`when`().post("/api/locations")
            .then()
            .statusCode(400)
            .body("error", equalTo("Invalid coordinates: lat must be [-90,90], lng must be [-180,180]"))
    }

    // ========================== Helpers ==========================

    private fun seedMemberAndGetFamily(userId: String, displayName: String): java.util.UUID {
        val familyGroupId = dsl.select(field("id", SQLDataType.UUID))
            .from(table("family_groups"))
            .limit(1)
            .fetchOne()!!
            .get(field("id", SQLDataType.UUID))!!

        val now = OffsetDateTime.now(ZoneOffset.UTC)
        dsl.insertInto(table("members"))
            .set(field("id", SQLDataType.VARCHAR), userId)
            .set(field("family_group_id", SQLDataType.UUID), familyGroupId)
            .set(field("display_name", SQLDataType.VARCHAR), displayName)
            .set(field("role", SQLDataType.VARCHAR), "member")
            .set(field("created_at", SQLDataType.TIMESTAMPWITHTIMEZONE), now)
            .set(field("updated_at", SQLDataType.TIMESTAMPWITHTIMEZONE), now)
            .execute()

        return familyGroupId
    }
}
