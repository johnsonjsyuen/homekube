package com.homekube.webscraper

import com.homekube.webscraper.activities.ScraperActivitiesImpl
import com.homekube.webscraper.workflow.WebScraperWorkflowImpl
import io.quarkus.runtime.ShutdownEvent
import io.quarkus.runtime.StartupEvent
import io.temporal.client.WorkflowClient
import io.temporal.client.WorkflowClientOptions
import io.temporal.serviceclient.WorkflowServiceStubs
import io.temporal.serviceclient.WorkflowServiceStubsOptions
import io.temporal.worker.WorkerFactory
import jakarta.enterprise.context.ApplicationScoped
import jakarta.enterprise.event.Observes
import jakarta.inject.Inject
import org.eclipse.microprofile.config.inject.ConfigProperty
import org.jboss.logging.Logger

@ApplicationScoped
class TemporalWorkerLifecycle {

    private val log = Logger.getLogger(TemporalWorkerLifecycle::class.java)

    @Inject
    lateinit var activities: ScraperActivitiesImpl

    @Inject
    lateinit var scheduleManager: ScheduleManager

    @ConfigProperty(name = "app.temporal.address")
    lateinit var temporalAddress: String

    @ConfigProperty(name = "app.temporal.task-queue")
    lateinit var taskQueue: String

    private lateinit var factory: WorkerFactory
    private lateinit var serviceStubs: WorkflowServiceStubs

    lateinit var workflowClient: WorkflowClient
        private set

    fun onStart(@Observes event: StartupEvent) {
        log.infof("Connecting to Temporal at %s", temporalAddress)

        serviceStubs = WorkflowServiceStubs.newServiceStubs(
            WorkflowServiceStubsOptions.newBuilder()
                .setTarget(temporalAddress)
                .build()
        )

        workflowClient = WorkflowClient.newInstance(
            serviceStubs,
            WorkflowClientOptions.newBuilder().build()
        )

        // Initialize schedule manager with the service stubs
        scheduleManager.init(serviceStubs)

        factory = WorkerFactory.newInstance(workflowClient)

        val worker = factory.newWorker(taskQueue)
        worker.registerWorkflowImplementationTypes(WebScraperWorkflowImpl::class.java)
        worker.registerActivitiesImplementations(activities)

        factory.start()
        log.infof("Temporal worker started on task queue '%s'", taskQueue)
    }

    fun onStop(@Observes event: ShutdownEvent) {
        log.info("Shutting down Temporal worker")
        if (::factory.isInitialized) {
            factory.shutdown()
        }
        if (::serviceStubs.isInitialized) {
            serviceStubs.shutdown()
        }
    }
}
