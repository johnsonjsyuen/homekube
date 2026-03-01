package com.homekube.webscraper

import io.quarkus.security.Authenticated
import io.smallrye.common.annotation.Blocking
import io.temporal.client.WorkflowClient
import io.temporal.client.WorkflowOptions
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import jakarta.transaction.Transactional
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

    @Inject
    lateinit var jobRepository: JobRepository

    @Inject
    lateinit var runRepository: RunRepository

    @Inject
    lateinit var scheduleManager: ScheduleManager

    @Inject
    lateinit var metricsService: MetricsService

    @Inject
    lateinit var temporalWorkerLifecycle: TemporalWorkerLifecycle

    @ConfigProperty(name = "app.max-jobs-per-user", defaultValue = "10")
    var maxJobsPerUser: Int = 10

    companion object {
        private val CRON_REGEX = Regex("^([0-9*/,\\-]+\\s+){4}[0-9*/,\\-]+$")

        fun validateCron(cron: String): Boolean = CRON_REGEX.matches(cron.trim())
    }

    private fun getUserId(securityContext: SecurityContext): String =
        securityContext.userPrincipal.name

    // GET /api/jobs -- list caller's jobs
    @GET
    @Path("/jobs")
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

    // POST /api/jobs -- create a new job
    @POST
    @Path("/jobs")
    @Transactional
    fun createJob(body: CreateJobRequest, @Context securityContext: SecurityContext): Response {
        return try {
            val userId = getUserId(securityContext)

            // Validate required fields
            if (body.name.isNullOrBlank() || body.urls.isNullOrEmpty() || body.instruction.isNullOrBlank()) {
                return Response.status(400)
                    .entity(mapOf("error" to "name, urls (non-empty array), and instruction are required"))
                    .build()
            }

            // Validate cron if provided
            val cron = body.schedule_cron ?: "0 */3 * * *"
            if (!validateCron(cron)) {
                return Response.status(400)
                    .entity(mapOf("error" to "Invalid cron expression"))
                    .build()
            }

            // Check job limit
            if (jobRepository.countByUserId(userId) >= maxJobsPerUser) {
                return Response.status(400)
                    .entity(mapOf("error" to "Maximum $maxJobsPerUser jobs per user"))
                    .build()
            }

            val tz = body.timezone ?: "Australia/Sydney"
            val job = ScrapeJob(
                userId = userId,
                name = body.name,
                urls = body.urls.toTypedArray(),
                instruction = body.instruction,
                scheduleCron = cron,
                timezone = tz,
            )

            jobRepository.persist(job)

            // Create Temporal schedule
            scheduleManager.createSchedule(job.id.toString(), cron, tz)

            // Update active jobs gauge
            metricsService.updateActiveJobs(jobRepository.countEnabled())

            Response.status(201).entity(JobResponse(job)).build()
        } catch (e: Exception) {
            log.error("Create job error", e)
            Response.status(500).entity(mapOf("error" to e.message)).build()
        }
    }

    // GET /api/jobs/{id} -- get a single job
    @GET
    @Path("/jobs/{id}")
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

    // PUT /api/jobs/{id} -- update a job
    @PUT
    @Path("/jobs/{id}")
    @Transactional
    fun updateJob(
        @PathParam("id") id: UUID,
        body: UpdateJobRequest,
        @Context securityContext: SecurityContext,
    ): Response {
        return try {
            val userId = getUserId(securityContext)

            val oldJob = jobRepository.findByIdAndUserId(id, userId)
                ?: return Response.status(404).entity(mapOf("error" to "Job not found")).build()

            // Validate cron if provided
            if (body.schedule_cron != null && !validateCron(body.schedule_cron)) {
                return Response.status(400)
                    .entity(mapOf("error" to "Invalid cron expression"))
                    .build()
            }

            // Validate urls if provided
            if (body.urls != null && body.urls.isEmpty()) {
                return Response.status(400)
                    .entity(mapOf("error" to "urls must be a non-empty array"))
                    .build()
            }

            // Apply COALESCE logic: only update fields that are provided
            val updatedJob = oldJob.copy(
                name = body.name ?: oldJob.name,
                urls = body.urls?.toTypedArray() ?: oldJob.urls,
                instruction = body.instruction ?: oldJob.instruction,
                scheduleCron = body.schedule_cron ?: oldJob.scheduleCron,
                timezone = body.timezone ?: oldJob.timezone,
                enabled = body.enabled ?: oldJob.enabled,
                updatedAt = Instant.now(),
            )

            jobRepository.getEntityManager().merge(updatedJob)

            // Handle schedule changes
            val newCron = body.schedule_cron ?: oldJob.scheduleCron
            val newTz = body.timezone ?: oldJob.timezone
            val newEnabled = body.enabled ?: oldJob.enabled

            if (body.schedule_cron != null || body.timezone != null) {
                // Schedule or timezone changed -- recreate schedule
                scheduleManager.updateSchedule(id.toString(), newCron, newTz)
                if (!newEnabled) {
                    scheduleManager.pauseSchedule(id.toString())
                }
            } else if (body.enabled != null && body.enabled != oldJob.enabled) {
                // Only enabled/disabled changed
                if (body.enabled) {
                    scheduleManager.unpauseSchedule(id.toString())
                } else {
                    scheduleManager.pauseSchedule(id.toString())
                }
            }

            // Update active jobs gauge
            metricsService.updateActiveJobs(jobRepository.countEnabled())

            Response.ok(JobResponse(updatedJob)).build()
        } catch (e: Exception) {
            log.error("Update job error", e)
            Response.status(500).entity(mapOf("error" to e.message)).build()
        }
    }

    // DELETE /api/jobs/{id} -- delete a job
    @DELETE
    @Path("/jobs/{id}")
    @Transactional
    fun deleteJob(@PathParam("id") id: UUID, @Context securityContext: SecurityContext): Response {
        return try {
            val userId = getUserId(securityContext)

            val deleted = jobRepository.deleteByIdAndUserId(id, userId)
            if (deleted == 0L) {
                return Response.status(404).entity(mapOf("error" to "Job not found")).build()
            }

            // Delete Temporal schedule
            scheduleManager.deleteSchedule(id.toString())

            // Update active jobs gauge
            metricsService.updateActiveJobs(jobRepository.countEnabled())

            Response.ok(DeleteResponse()).build()
        } catch (e: Exception) {
            log.error("Delete job error", e)
            Response.status(500).entity(mapOf("error" to e.message)).build()
        }
    }

    // POST /api/jobs/{id}/trigger -- manually trigger a job
    @POST
    @Path("/jobs/{id}/trigger")
    fun triggerJob(@PathParam("id") id: UUID, @Context securityContext: SecurityContext): Response {
        return try {
            val userId = getUserId(securityContext)

            val job = jobRepository.findByIdAndUserId(id, userId)
                ?: return Response.status(404).entity(mapOf("error" to "Job not found")).build()

            val workflowClient = temporalWorkerLifecycle.workflowClient
            val workflowId = "web-scraper-${id}-manual-${System.currentTimeMillis()}"

            val options = WorkflowOptions.newBuilder()
                .setTaskQueue("web-scraper-queue")
                .setWorkflowId(workflowId)
                .build()

            val workflow = workflowClient.newWorkflowStub(
                com.homekube.webscraper.workflow.WebScraperWorkflow::class.java,
                options,
            )

            WorkflowClient.start(workflow::execute, WebScraperInput(id.toString()))

            Response.ok(TriggerResponse(workflowId)).build()
        } catch (e: Exception) {
            log.error("Trigger job error", e)
            Response.status(500).entity(mapOf("error" to e.message)).build()
        }
    }

    // GET /api/jobs/{id}/runs -- get run history
    @GET
    @Path("/jobs/{id}/runs")
    fun getJobRuns(
        @PathParam("id") id: UUID,
        @QueryParam("limit") @DefaultValue("20") limit: Int,
        @Context securityContext: SecurityContext,
    ): Response {
        return try {
            val userId = getUserId(securityContext)

            // Check ownership
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
}
