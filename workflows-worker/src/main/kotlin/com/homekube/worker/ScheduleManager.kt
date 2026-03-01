package com.homekube.worker

import io.grpc.StatusRuntimeException
import io.temporal.client.schedules.Schedule
import io.temporal.client.schedules.ScheduleActionStartWorkflow
import io.temporal.client.schedules.ScheduleClient
import io.temporal.client.schedules.ScheduleOptions
import io.temporal.client.schedules.SchedulePolicy
import io.temporal.client.schedules.ScheduleSpec
import io.temporal.client.WorkflowOptions
import io.temporal.api.enums.v1.ScheduleOverlapPolicy
import io.temporal.serviceclient.WorkflowServiceStubs
import jakarta.enterprise.context.ApplicationScoped
import jakarta.inject.Inject
import org.eclipse.microprofile.config.inject.ConfigProperty
import org.jboss.logging.Logger

@ApplicationScoped
class ScheduleManager {

    private val log = Logger.getLogger(ScheduleManager::class.java)

    @Inject
    lateinit var serviceStubs: WorkflowServiceStubs

    @ConfigProperty(name = "quarkus.temporal.worker.task-queue", defaultValue = "workflows-worker-queue")
    lateinit var taskQueue: String

    private val scheduleClient: ScheduleClient by lazy {
        ScheduleClient.newInstance(serviceStubs)
    }

    fun createSchedule(scheduleId: String, workflowType: String, cron: String, timezone: String, args: Any? = null) {
        val actionBuilder = ScheduleActionStartWorkflow.newBuilder()
            .setWorkflowType(workflowType)
            .setOptions(
                WorkflowOptions.newBuilder()
                    .setTaskQueue(taskQueue)
                    .setWorkflowId("$workflowType-$scheduleId")
                    .build()
            )

        if (args != null) {
            actionBuilder.setArguments(args)
        }

        val action = actionBuilder.build()

        val spec = ScheduleSpec.newBuilder()
            .setCronExpressions(listOf(cron))
            .setTimeZoneName(timezone)
            .build()

        val policy = SchedulePolicy.newBuilder()
            .setOverlap(ScheduleOverlapPolicy.SCHEDULE_OVERLAP_POLICY_SKIP)
            .build()

        val schedule = Schedule.newBuilder()
            .setAction(action)
            .setSpec(spec)
            .setPolicy(policy)
            .build()

        val options = ScheduleOptions.newBuilder().build()

        scheduleClient.createSchedule(scheduleId, schedule, options)
        log.infof("Created schedule %s", scheduleId)
    }

    fun deleteSchedule(scheduleId: String) {
        try {
            val handle = scheduleClient.getHandle(scheduleId)
            handle.delete()
            log.infof("Deleted schedule %s", scheduleId)
        } catch (e: StatusRuntimeException) {
            if (e.status.code == io.grpc.Status.Code.NOT_FOUND) {
                log.infof("Schedule %s not found, nothing to delete", scheduleId)
            } else {
                throw e
            }
        }
    }

    fun createOrUpdateSchedule(scheduleId: String, workflowType: String, cron: String, timezone: String, args: Any? = null) {
        deleteSchedule(scheduleId)
        createSchedule(scheduleId, workflowType, cron, timezone, args)
    }

    fun pauseSchedule(scheduleId: String) {
        try {
            val handle = scheduleClient.getHandle(scheduleId)
            handle.pause("Job disabled by user")
            log.infof("Paused schedule %s", scheduleId)
        } catch (e: StatusRuntimeException) {
            if (e.status.code == io.grpc.Status.Code.NOT_FOUND) {
                log.infof("Schedule %s not found, nothing to pause", scheduleId)
            } else {
                throw e
            }
        }
    }

    fun unpauseSchedule(scheduleId: String) {
        try {
            val handle = scheduleClient.getHandle(scheduleId)
            handle.unpause("Job enabled by user")
            log.infof("Unpaused schedule %s", scheduleId)
        } catch (e: StatusRuntimeException) {
            if (e.status.code == io.grpc.Status.Code.NOT_FOUND) {
                log.infof("Schedule %s not found, nothing to unpause", scheduleId)
            } else {
                throw e
            }
        }
    }
}
