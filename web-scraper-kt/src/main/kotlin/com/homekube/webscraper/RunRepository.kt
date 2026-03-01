package com.homekube.webscraper

import io.quarkus.hibernate.orm.panache.kotlin.PanacheRepositoryBase
import jakarta.enterprise.context.ApplicationScoped
import java.util.UUID

@ApplicationScoped
class RunRepository : PanacheRepositoryBase<ScrapeRun, UUID> {

    fun findByJobId(jobId: UUID, limit: Int): List<ScrapeRun> =
        find("jobId", io.quarkus.panache.common.Sort.descending("startedAt"), jobId)
            .page(0, limit)
            .list()
}
