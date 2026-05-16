package com.homekube.location

import com.fasterxml.jackson.annotation.JsonProperty
import io.quarkus.runtime.annotations.RegisterForReflection

// --- API Request/Response DTOs (camelCase JSON, matching client LocationApi types) ---

@RegisterForReflection
data class LocationReport(
    val lat: Double = 0.0,
    val lng: Double = 0.0,
    val accuracy: Double = 0.0,
    val altitude: Double? = null,
    val speed: Double? = null,
    val bearing: Double? = null,
    val battery: Int? = null,
    val timestamp: String = "",
    val memberId: String? = null, // ignored by server, overridden with JWT sub
)

@RegisterForReflection
data class MemberLocation(
    val memberId: String = "",
    val displayName: String = "",
    val avatarUrl: String? = null,
    val lat: Double = 0.0,
    val lng: Double = 0.0,
    val accuracy: Double = 0.0,
    val altitude: Double? = null,
    val speed: Double? = null,
    val bearing: Double? = null,
    val battery: Int? = null,
    val timestamp: String = "",
    @get:JsonProperty("isOnline")
    val isOnline: Boolean = false,
)

@RegisterForReflection
data class Place(
    val id: String = "",
    val name: String = "",
    val lat: Double = 0.0,
    val lng: Double = 0.0,
    val radiusMeters: Double = 0.0,
    val icon: String = "",
    val createdBy: String = "",
    val createdAt: String = "",
)

@RegisterForReflection
data class PlaceCreate(
    val name: String = "",
    val lat: Double = 0.0,
    val lng: Double = 0.0,
    val radiusMeters: Double = 0.0,
    val icon: String = "\uD83D\uDCCD", // pin emoji
)

@RegisterForReflection
data class PlaceUpdate(
    val name: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val radiusMeters: Double? = null,
    val icon: String? = null,
)

@RegisterForReflection
data class HistoryPoint(
    val lat: Double = 0.0,
    val lng: Double = 0.0,
    val accuracy: Double = 0.0,
    val speed: Double? = null,
    val timestamp: String = "",
)

@RegisterForReflection
data class FamilyGroup(
    val id: String = "",
    val name: String = "",
    val members: List<FamilyMember> = emptyList(),
)

@RegisterForReflection
data class FamilyMember(
    val id: String = "",
    val displayName: String = "",
    val avatarUrl: String? = null,
    val role: String = "member",
)
