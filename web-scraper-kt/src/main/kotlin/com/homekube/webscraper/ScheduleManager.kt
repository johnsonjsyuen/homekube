package com.homekube.webscraper

import io.grpc.StatusRuntimeException
import io.temporal.client.schedules.Schedule
import io.temporal.client.schedules.ScheduleActionStartWorkflow
import io.temporal.client.schedules.ScheduleClient
import io.temporal.client.schedules.ScheduleOptions
import io.temporal.client.schedules.ScheduleOverlapPolicy
import io.temporal.client.schedules.SchedulePolicy
import io.temporal.client.schedules.ScheduleSpec
import io.temporal.serviceclient.WorkflowServiceStubs
import jakarta.enterprise.context.ApplicationScoped
import org.jboss.logging.Logger

@ApplicationScoped
class ScheduleManager {

    private val log = Logger.getLogger(ScheduleManager::class.java)

    lateinit var scheduleClient: ScheduleClient

    fun init(serviceStubs: WorkflowServiceStubs) {
        this.scheduleClient = ScheduleClient.newInstance(serviceStubs)
    }

    private fun scheduleId(jobId: String): String = "web-scraper-$jobId"

    fun createSchedule(jobId: String, cron: String, timezone: String) {
        val id = scheduleId(jobId)

        val action = ScheduleActionStartWorkflow.newBuilder()
            .setWorkflowType("WebScraperWorkflow")
            .setTaskQueue("web-scraper-queue")
            .setWorkflowId("web-scraper-$jobId")
            .setArguments(WebScraperInput(jobId))
            .build()

        val spec = ScheduleSpec.newBuilder()
            .setCronExpressions(listOf(cron))
            .setTimeZone(timezone)
            .build()

        val policy = SchedulePolicy.newBuilder()
            .setOverlap(ScheduleOverlapPolicy.SKIP)
            .build()

        val schedule = Schedule.newBuilder()
            .setAction(action)
            .setSpec(spec)
            .setPolicy(policy)
            .build()

        val options = ScheduleOptions.newBuilder().build()

        scheduleClient.createSchedule(id, schedule, options)
        log.infof("Created schedule %s", id)
    }

    fun deleteSchedule(jobId: String) {
        val id = scheduleId(jobId)
        try {
            val handle = scheduleClient.getHandle(id)
            handle.delete()
            log.infof("Deleted schedule %s", id)
        } catch (e: StatusRuntimeException) {
            if (e.status.code == io.grpc.Status.Code.NOT_FOUND) {
                log.infof("Schedule %s not found, nothing to delete", id)
            } else {
                throw e
            }
        }
    }

    fun updateSchedule(jobId: String, cron: String, timezone: String) {
        deleteSchedule(jobId)
        createSchedule(jobId, cron, timezone)
    }

    fun pauseSchedule(jobId: String) {
        val id = scheduleId(jobId)
        try {
            val handle = scheduleClient.getHandle(id)
            handle.pause("Job disabled by user")
            log.infof("Paused schedule %s", id)
        } catch (e: StatusRuntimeException) {
            if (e.status.code == io.grpc.Status.Code.NOT_FOUND) {
                log.infof("Schedule %s not found, nothing to pause", id)
            } else {
                throw e
            }
        }
    }

    fun unpauseSchedule(jobId: String) {
        val id = scheduleId(jobId)
        try {
            val handle = scheduleClient.getHandle(id)
            handle.unpause("Job enabled by user")
            log.infof("Unpaused schedule %s", id)
        } catch (e: StatusRuntimeException) {
            if (e.status.code == io.grpc.Status.Code.NOT_FOUND) {
                log.infof("Schedule %s not found, nothing to unpause", id)
            } else {
                throw e
            }
        }
    }
}
