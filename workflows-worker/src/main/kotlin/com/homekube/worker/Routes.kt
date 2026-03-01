package com.homekube.worker

import io.quarkus.security.Authenticated
import io.smallrye.common.annotation.Blocking
import io.temporal.client.WorkflowClient
import io.temporal.client.WorkflowOptions
import com.homekube.worker.workflow.NewsDigestWorkflow
import com.homekube.worker.workflow.EconomistDigestWorkflow
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import jakarta.ws.rs.Consumes
import jakarta.ws.rs.DELETE
import jakarta.ws.rs.DefaultValue
import jakarta.ws.rs.GET
import jakarta.ws.rs.POST
import jakarta.ws.rs.PUT
import jakarta.ws.rs.Path
import jakarta.ws.rs.PathParam
import jakarta.ws.rs.Produces
import jakarta.ws.rs.QueryParam
import jakarta.ws.rs.core.Context
import jakarta.ws.rs.core.MediaType
import jakarta.ws.rs.core.Response
import jakarta.ws.rs.core.SecurityContext
import org.eclipse.microprofile.config.inject.ConfigProperty
import org.jboss.logging.Logger
import java.time.Instant
import java.util.UUID

@Path("/api")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
@Blocking
@ApplicationScoped
class ScraperResource {

    private val log = Logger.getLogger(ScraperResource::class.java)

    @Inject lateinit var jobRepository: JobRepository
    @Inject lateinit var runRepository: RunRepository
    @Inject lateinit var digestSubscriptionRepository: DigestSubscriptionRepository
    @Inject lateinit var scheduleManager: ScheduleManager
    @Inject lateinit var metricsService: MetricsService
    @Inject lateinit var workflowClient: WorkflowClient

    @ConfigProperty(name = "app.max-jobs-per-user", defaultValue = "10")
    var maxJobsPerUser: Int = 10

    @ConfigProperty(name = "quarkus.temporal.worker.task-queue", defaultValue = "workflows-worker-queue")
    lateinit var taskQueue: String

    companion object {
        private val CRON_REGEX = Regex("^([0-9*/,\\-]+\\s+){4}[0-9*/,\\-]+$")
        fun validateCron(cron: String): Boolean = CRON_REGEX.matches(cron.trim())
    }

    private fun getUserId(securityContext: SecurityContext): String =
        securityContext.userPrincipal.name

    // ===================== Web Scraper Job Endpoints =====================

    @GET @Path("/jobs")
    fun listJobs(@Context securityContext: SecurityContext): Response {
        return try {
            val userId = getUserId(securityContext)
            val jobs = jobRepository.findByUserId(userId)
            Response.ok(JobListResponse(jobs)).build()
        } catch (e: Exception) {
            log.error("List jobs error", e)
            Response.status(500).entity(mapOf("error" to e.message)).build()
        }
    }

    @POST @Path("/jobs")
    fun createJob(body: CreateJobRequest, @Context securityContext: SecurityContext): Response {
        return try {
            val userId = getUserId(securityContext)

            if (body.name.isNullOrBlank() || body.urls.isNullOrEmpty() || body.instruction.isNullOrBlank()) {
                return Response.status(400)
                    .entity(mapOf("error" to "name, urls (non-empty array), and instruction are required"))
                    .build()
            }

            val cron = body.schedule_cron ?: "0 */3 * * *"
            if (!validateCron(cron)) {
                return Response.status(400).entity(mapOf("error" to "Invalid cron expression")).build()
            }

            if (jobRepository.countByUserId(userId) >= maxJobsPerUser) {
                return Response.status(400).entity(mapOf("error" to "Maximum $maxJobsPerUser jobs per user")).build()
            }

            val tz = body.timezone ?: "Australia/Sydney"
            val job = ScrapeJob(
                userId = userId,
                name = body.name,
                urls = body.urls,
                instruction = body.instruction,
                scheduleCron = cron,
                timezone = tz,
            )

            jobRepository.insert(job)

            scheduleManager.createSchedule(
                scheduleId = "web-scraper-${job.id}",
                workflowType = "WebScraperWorkflow",
                cron = cron,
                timezone = tz,
                args = WebScraperInput(job.id.toString()),
            )

            metricsService.updateActiveJobs(jobRepository.countEnabled())

            Response.status(201).entity(JobResponse(job)).build()
        } catch (e: Exception) {
            log.error("Create job error", e)
            Response.status(500).entity(mapOf("error" to e.message)).build()
        }
    }

    @GET @Path("/jobs/{id}")
    fun getJob(@PathParam("id") id: UUID, @Context securityContext: SecurityContext): Response {
        return try {
            val userId = getUserId(securityContext)
            val job = jobRepository.findByIdAndUserId(id, userId)
                ?: return Response.status(404).entity(mapOf("error" to "Job not found")).build()
            Response.ok(JobResponse(job)).build()
        } catch (e: Exception) {
            log.error("Get job error", e)
            Response.status(500).entity(mapOf("error" to e.message)).build()
        }
    }

    @PUT @Path("/jobs/{id}")
    fun updateJob(@PathParam("id") id: UUID, body: UpdateJobRequest, @Context securityContext: SecurityContext): Response {
        return try {
            val userId = getUserId(securityContext)

            val oldJob = jobRepository.findByIdAndUserId(id, userId)
                ?: return Response.status(404).entity(mapOf("error" to "Job not found")).build()

            if (body.schedule_cron != null && !validateCron(body.schedule_cron)) {
                return Response.status(400).entity(mapOf("error" to "Invalid cron expression")).build()
            }

            if (body.urls != null && body.urls.isEmpty()) {
                return Response.status(400).entity(mapOf("error" to "urls must be a non-empty array")).build()
            }

            val updatedJob = oldJob.copy(
                name = body.name ?: oldJob.name,
                urls = body.urls ?: oldJob.urls,
                instruction = body.instruction ?: oldJob.instruction,
                scheduleCron = body.schedule_cron ?: oldJob.scheduleCron,
                timezone = body.timezone ?: oldJob.timezone,
                enabled = body.enabled ?: oldJob.enabled,
                updatedAt = Instant.now(),
            )

            jobRepository.update(updatedJob)

            val newCron = body.schedule_cron ?: oldJob.scheduleCron
            val newTz = body.timezone ?: oldJob.timezone
            val newEnabled = body.enabled ?: oldJob.enabled
            val schedId = "web-scraper-$id"

            if (body.schedule_cron != null || body.timezone != null) {
                scheduleManager.createOrUpdateSchedule(
                    scheduleId = schedId,
                    workflowType = "WebScraperWorkflow",
                    cron = newCron,
                    timezone = newTz,
                    args = WebScraperInput(id.toString()),
                )
                if (!newEnabled) scheduleManager.pauseSchedule(schedId)
            } else if (body.enabled != null && body.enabled != oldJob.enabled) {
                if (body.enabled) scheduleManager.unpauseSchedule(schedId)
                else scheduleManager.pauseSchedule(schedId)
            }

            metricsService.updateActiveJobs(jobRepository.countEnabled())
            Response.ok(JobResponse(updatedJob)).build()
        } catch (e: Exception) {
            log.error("Update job error", e)
            Response.status(500).entity(mapOf("error" to e.message)).build()
        }
    }

    @DELETE @Path("/jobs/{id}")
    fun deleteJob(@PathParam("id") id: UUID, @Context securityContext: SecurityContext): Response {
        return try {
            val userId = getUserId(securityContext)
            val deleted = jobRepository.deleteByIdAndUserId(id, userId)
            if (deleted == 0) {
                return Response.status(404).entity(mapOf("error" to "Job not found")).build()
            }
            scheduleManager.deleteSchedule("web-scraper-$id")
            metricsService.updateActiveJobs(jobRepository.countEnabled())
            Response.ok(DeleteResponse()).build()
        } catch (e: Exception) {
            log.error("Delete job error", e)
            Response.status(500).entity(mapOf("error" to e.message)).build()
        }
    }

    @POST @Path("/jobs/{id}/trigger")
    fun triggerJob(@PathParam("id") id: UUID, @Context securityContext: SecurityContext): Response {
        return try {
            val userId = getUserId(securityContext)
            jobRepository.findByIdAndUserId(id, userId)
                ?: return Response.status(404).entity(mapOf("error" to "Job not found")).build()

            val workflowId = "web-scraper-$id-manual-${System.currentTimeMillis()}"
            val options = WorkflowOptions.newBuilder()
                .setTaskQueue(taskQueue)
                .setWorkflowId(workflowId)
                .build()

            val workflow = workflowClient.newWorkflowStub(
                com.homekube.worker.workflow.WebScraperWorkflow::class.java, options,
            )
            WorkflowClient.start(workflow::execute, WebScraperInput(id.toString()))

            Response.ok(TriggerResponse(workflowId)).build()
        } catch (e: Exception) {
            log.error("Trigger job error", e)
            Response.status(500).entity(mapOf("error" to e.message)).build()
        }
    }

    @GET @Path("/jobs/{id}/runs")
    fun getJobRuns(
        @PathParam("id") id: UUID,
        @QueryParam("limit") @DefaultValue("20") limit: Int,
        @Context securityContext: SecurityContext,
    ): Response {
        return try {
            val userId = getUserId(securityContext)
            jobRepository.findByIdAndUserId(id, userId)
                ?: return Response.status(404).entity(mapOf("error" to "Job not found")).build()
            val effectiveLimit = limit.coerceIn(1, 100)
            val runs = runRepository.findByJobId(id, effectiveLimit)
            Response.ok(RunListResponse(runs)).build()
        } catch (e: Exception) {
            log.error("Get runs error", e)
            Response.status(500).entity(mapOf("error" to e.message)).build()
        }
    }

    // ===================== News Digest Endpoints =====================

    @POST @Path("/news/subscribe")
    fun subscribeNews(@Context securityContext: SecurityContext): Response {
        return try {
            val userId = getUserId(securityContext)
            digestSubscriptionRepository.upsert(userId, "news", true)
            Response.ok(SubscriptionResponse(subscribed = true)).build()
        } catch (e: Exception) {
            log.error("News subscribe error", e)
            Response.status(500).entity(mapOf("error" to e.message)).build()
        }
    }

    @POST @Path("/news/unsubscribe")
    fun unsubscribeNews(@Context securityContext: SecurityContext): Response {
        return try {
            val userId = getUserId(securityContext)
            digestSubscriptionRepository.upsert(userId, "news", false)
            Response.ok(SubscriptionResponse(subscribed = false)).build()
        } catch (e: Exception) {
            log.error("News unsubscribe error", e)
            Response.status(500).entity(mapOf("error" to e.message)).build()
        }
    }

    @GET @Path("/news/subscription-status")
    fun newsSubscriptionStatus(@Context securityContext: SecurityContext): Response {
        return try {
            val userId = getUserId(securityContext)
            val subscribed = digestSubscriptionRepository.isSubscribed(userId, "news")
            Response.ok(SubscriptionStatusResponse(subscribed = subscribed)).build()
        } catch (e: Exception) {
            log.error("News subscription status error", e)
            Response.status(500).entity(mapOf("error" to e.message)).build()
        }
    }

    @POST @Path("/news/trigger")
    fun triggerNews(@Context securityContext: SecurityContext): Response {
        return try {
            val workflowId = "news-digest-manual-${System.currentTimeMillis()}"
            val options = WorkflowOptions.newBuilder()
                .setTaskQueue(taskQueue)
                .setWorkflowId(workflowId)
                .build()
            val workflow = workflowClient.newWorkflowStub(NewsDigestWorkflow::class.java, options)
            WorkflowClient.start(workflow::execute)
            Response.ok(DigestTriggerResponse(workflowId = workflowId, message = "News digest workflow started")).build()
        } catch (e: Exception) {
            log.error("News trigger error", e)
            Response.status(500).entity(mapOf("error" to e.message)).build()
        }
    }

    // ===================== Economist Digest Endpoints =====================

    @POST @Path("/economist/subscribe")
    fun subscribeEconomist(@Context securityContext: SecurityContext): Response {
        return try {
            val userId = getUserId(securityContext)
            digestSubscriptionRepository.upsert(userId, "economist", true)
            Response.ok(SubscriptionResponse(subscribed = true)).build()
        } catch (e: Exception) {
            log.error("Economist subscribe error", e)
            Response.status(500).entity(mapOf("error" to e.message)).build()
        }
    }

    @POST @Path("/economist/unsubscribe")
    fun unsubscribeEconomist(@Context securityContext: SecurityContext): Response {
        return try {
            val userId = getUserId(securityContext)
            digestSubscriptionRepository.upsert(userId, "economist", false)
            Response.ok(SubscriptionResponse(subscribed = false)).build()
        } catch (e: Exception) {
            log.error("Economist unsubscribe error", e)
            Response.status(500).entity(mapOf("error" to e.message)).build()
        }
    }

    @GET @Path("/economist/subscription-status")
    fun economistSubscriptionStatus(@Context securityContext: SecurityContext): Response {
        return try {
            val userId = getUserId(securityContext)
            val subscribed = digestSubscriptionRepository.isSubscribed(userId, "economist")
            Response.ok(SubscriptionStatusResponse(subscribed = subscribed)).build()
        } catch (e: Exception) {
            log.error("Economist subscription status error", e)
            Response.status(500).entity(mapOf("error" to e.message)).build()
        }
    }

    @POST @Path("/economist/trigger")
    fun triggerEconomist(@Context securityContext: SecurityContext): Response {
        return try {
            val workflowId = "economist-digest-manual-${System.currentTimeMillis()}"
            val options = WorkflowOptions.newBuilder()
                .setTaskQueue(taskQueue)
                .setWorkflowId(workflowId)
                .build()
            val workflow = workflowClient.newWorkflowStub(EconomistDigestWorkflow::class.java, options)
            WorkflowClient.start(workflow::execute)
            Response.ok(DigestTriggerResponse(workflowId = workflowId, message = "Economist digest workflow started")).build()
        } catch (e: Exception) {
            log.error("Economist trigger error", e)
            Response.status(500).entity(mapOf("error" to e.message)).build()
        }
    }
}
