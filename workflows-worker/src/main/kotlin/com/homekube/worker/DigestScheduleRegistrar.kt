package com.homekube.worker

import io.quarkus.runtime.StartupEvent
import jakarta.enterprise.context.ApplicationScoped
import jakarta.enterprise.event.Observes
import jakarta.inject.Inject
import org.jboss.logging.Logger

@ApplicationScoped
class DigestScheduleRegistrar {

    private val log = Logger.getLogger(DigestScheduleRegistrar::class.java)

    @Inject
    lateinit var scheduleManager: ScheduleManager

    fun onStartup(@Observes ev: StartupEvent) {
        log.info("Registering digest schedules...")

        try {
            scheduleManager.createOrUpdateSchedule(
                scheduleId = "daily-news-digest",
                workflowType = "NewsDigestWorkflow",
                cron = "0 9 * * *",
                timezone = "Australia/Sydney",
            )
            log.info("Registered schedule: daily-news-digest (daily at 9:00 AM AEST/AEDT)")
        } catch (e: Exception) {
            log.errorf("Failed to register news digest schedule: %s", e.message)
        }

        try {
            scheduleManager.createOrUpdateSchedule(
                scheduleId = "economist-digest",
                workflowType = "EconomistDigestWorkflow",
                cron = "0 9 * * *",
                timezone = "Australia/Sydney",
            )
            log.info("Registered schedule: economist-digest (daily at 9:00 AM AEST/AEDT)")
        } catch (e: Exception) {
            log.errorf("Failed to register Economist digest schedule: %s", e.message)
        }
    }
}
