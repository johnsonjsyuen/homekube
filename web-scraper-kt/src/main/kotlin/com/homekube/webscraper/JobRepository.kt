package com.homekube.webscraper

import io.quarkus.hibernate.orm.panache.kotlin.PanacheRepositoryBase
import jakarta.enterprise.context.ApplicationScoped
import java.util.UUID

@ApplicationScoped
class JobRepository : PanacheRepositoryBase<ScrapeJob, UUID> {

    fun findByUserId(userId: String): List<ScrapeJob> =
        list("userId", io.quarkus.panache.common.Sort.descending("createdAt"), userId)

    fun findByIdAndUserId(id: UUID, userId: String): ScrapeJob? =
        find("id = ?1 and userId = ?2", id, userId).firstResult()

    fun countByUserId(userId: String): Long =
        count("userId", userId)

    fun countEnabled(): Long =
        count("enabled", true)

    fun deleteByIdAndUserId(id: UUID, userId: String): Long =
        delete("id = ?1 and userId = ?2", id, userId)
}
