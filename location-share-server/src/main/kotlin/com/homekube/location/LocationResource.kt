package com.homekube.location

import io.quarkus.security.Authenticated
import io.smallrye.common.annotation.Blocking
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import jakarta.ws.rs.Consumes
import jakarta.ws.rs.DELETE
import jakarta.ws.rs.GET
import jakarta.ws.rs.POST
import jakarta.ws.rs.PUT
import jakarta.ws.rs.Path
import jakarta.ws.rs.PathParam
import jakarta.ws.rs.Produces
import jakarta.ws.rs.QueryParam
import jakarta.ws.rs.core.MediaType
import jakarta.ws.rs.core.Response
import org.eclipse.microprofile.jwt.JsonWebToken
import org.jboss.logging.Logger
import java.util.UUID

@Path("/api")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
@Blocking
@ApplicationScoped
class LocationResource {

    private val log = Logger.getLogger(LocationResource::class.java)

    @Inject lateinit var jwt: JsonWebToken
    @Inject lateinit var memberRepository: MemberRepository
    @Inject lateinit var locationRepository: LocationRepository
    @Inject lateinit var placeRepository: PlaceRepository

    private fun getUserId(): String = jwt.subject ?: jwt.name
    private fun getDisplayName(): String =
        jwt.getClaim<String>("name")
            ?: jwt.getClaim<String>("preferred_username")
            ?: "Unknown"

    private fun ensureMember(): MemberRow =
        memberRepository.ensureMember(getUserId(), getDisplayName())

    // ===================== Family =====================

    @GET @Path("/family")
    fun getFamily(): Response {
        return try {
            val member = ensureMember()
            val family = memberRepository.getFamilyGroup(member.familyGroupId)
                ?: return Response.status(404).entity(mapOf("error" to "Family group not found")).build()
            Response.ok(family).build()
        } catch (e: Exception) {
            log.error("Get family error", e)
            Response.status(500).entity(mapOf("error" to "Internal server error")).build()
        }
    }

    // ===================== Locations =====================

    @GET @Path("/family/locations")
    fun getFamilyLocations(): Response {
        return try {
            val member = ensureMember()
            val locations = locationRepository.getLatestPerMember(member.familyGroupId)
            Response.ok(locations).build()
        } catch (e: Exception) {
            log.error("Get family locations error", e)
            Response.status(500).entity(mapOf("error" to "Internal server error")).build()
        }
    }

    @POST @Path("/locations")
    fun reportLocations(reports: List<LocationReport>): Response {
        return try {
            val member = ensureMember()

            if (reports.isEmpty()) {
                return Response.noContent().build()
            }

            if (reports.size > 100) {
                return Response.status(400)
                    .entity(mapOf("error" to "Maximum 100 locations per batch"))
                    .build()
            }

            for (r in reports) {
                if (r.lat < -90 || r.lat > 90 || r.lng < -180 || r.lng > 180) {
                    return Response.status(400)
                        .entity(mapOf("error" to "Invalid coordinates: lat must be [-90,90], lng must be [-180,180]"))
                        .build()
                }
            }

            // Override memberId with authenticated user's ID
            locationRepository.insertBatch(member.id, reports)
            Response.noContent().build()
        } catch (e: java.time.format.DateTimeParseException) {
            Response.status(400)
                .entity(mapOf("error" to "Invalid timestamp format, expected ISO 8601"))
                .build()
        } catch (e: Exception) {
            log.error("Report locations error", e)
            Response.status(500).entity(mapOf("error" to "Internal server error")).build()
        }
    }

    @GET @Path("/locations/history")
    fun getLocationHistory(
        @QueryParam("memberId") memberId: String?,
        @QueryParam("date") date: String?,
    ): Response {
        return try {
            if (memberId.isNullOrBlank() || date.isNullOrBlank()) {
                return Response.status(400)
                    .entity(mapOf("error" to "memberId and date query parameters are required"))
                    .build()
            }

            val member = ensureMember()
            val history = locationRepository.getHistory(memberId, member.familyGroupId, date)
            Response.ok(history).build()
        } catch (e: java.time.format.DateTimeParseException) {
            Response.status(400)
                .entity(mapOf("error" to "Invalid date format, expected YYYY-MM-DD"))
                .build()
        } catch (e: Exception) {
            log.error("Get location history error", e)
            Response.status(500).entity(mapOf("error" to "Internal server error")).build()
        }
    }

    // ===================== Places =====================

    @GET @Path("/places")
    fun getPlaces(): Response {
        return try {
            val member = ensureMember()
            val places = placeRepository.findByFamilyGroupId(member.familyGroupId)
            Response.ok(places).build()
        } catch (e: Exception) {
            log.error("Get places error", e)
            Response.status(500).entity(mapOf("error" to "Internal server error")).build()
        }
    }

    @POST @Path("/places")
    fun createPlace(body: PlaceCreate): Response {
        return try {
            val member = ensureMember()

            if (body.name.isBlank()) {
                return Response.status(400).entity(mapOf("error" to "name is required")).build()
            }
            if (body.lat < -90 || body.lat > 90 || body.lng < -180 || body.lng > 180) {
                return Response.status(400)
                    .entity(mapOf("error" to "Invalid coordinates"))
                    .build()
            }
            if (body.radiusMeters < 50 || body.radiusMeters > 2000) {
                return Response.status(400)
                    .entity(mapOf("error" to "radiusMeters must be between 50 and 2000"))
                    .build()
            }

            val place = placeRepository.insert(member.familyGroupId, member.id, body)
            Response.status(201).entity(place).build()
        } catch (e: Exception) {
            log.error("Create place error", e)
            Response.status(500).entity(mapOf("error" to "Internal server error")).build()
        }
    }

    @PUT @Path("/places/{id}")
    fun updatePlace(@PathParam("id") id: String, body: PlaceUpdate): Response {
        return try {
            val member = ensureMember()
            val placeId = try { UUID.fromString(id) } catch (_: Exception) {
                return Response.status(400).entity(mapOf("error" to "Invalid place ID")).build()
            }

            body.lat?.let {
                if (it < -90 || it > 90) return Response.status(400)
                    .entity(mapOf("error" to "Invalid latitude")).build()
            }
            body.lng?.let {
                if (it < -180 || it > 180) return Response.status(400)
                    .entity(mapOf("error" to "Invalid longitude")).build()
            }
            body.radiusMeters?.let {
                if (it < 50 || it > 2000) return Response.status(400)
                    .entity(mapOf("error" to "radiusMeters must be between 50 and 2000")).build()
            }

            val updated = placeRepository.update(placeId, member.familyGroupId, body)
            if (updated == 0) {
                return Response.status(404).entity(mapOf("error" to "Place not found")).build()
            }

            val place = placeRepository.findByIdAndFamilyGroupId(placeId, member.familyGroupId)
                ?: return Response.status(404).entity(mapOf("error" to "Place not found")).build()
            Response.ok(place).build()
        } catch (e: Exception) {
            log.error("Update place error", e)
            Response.status(500).entity(mapOf("error" to "Internal server error")).build()
        }
    }

    @DELETE @Path("/places/{id}")
    fun deletePlace(@PathParam("id") id: String): Response {
        return try {
            val member = ensureMember()
            val placeId = try { UUID.fromString(id) } catch (_: Exception) {
                return Response.status(400).entity(mapOf("error" to "Invalid place ID")).build()
            }

            val deleted = placeRepository.delete(placeId, member.familyGroupId)
            if (deleted == 0) {
                return Response.status(404).entity(mapOf("error" to "Place not found")).build()
            }
            Response.noContent().build()
        } catch (e: Exception) {
            log.error("Delete place error", e)
            Response.status(500).entity(mapOf("error" to "Internal server error")).build()
        }
    }
}
