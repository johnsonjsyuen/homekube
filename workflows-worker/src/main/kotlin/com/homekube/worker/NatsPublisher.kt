package com.homekube.worker

import io.nats.client.Connection
import io.nats.client.JetStream
import io.nats.client.Nats
import jakarta.annotation.PreDestroy
import jakarta.enterprise.context.ApplicationScoped
import org.eclipse.microprofile.config.inject.ConfigProperty
import org.jboss.logging.Logger

@ApplicationScoped
class NatsPublisher {

    private val log = Logger.getLogger(NatsPublisher::class.java)

    @ConfigProperty(name = "nats.url")
    lateinit var natsUrl: String

    private var connection: Connection? = null
    private var jetStream: JetStream? = null

    @Synchronized
    private fun ensureConnected(): JetStream {
        if (connection == null || connection!!.status != Connection.Status.CONNECTED) {
            connection = Nats.connect(natsUrl)
            jetStream = connection!!.jetStream()
            log.infof("Connected to NATS JetStream at %s", natsUrl)
        }
        return jetStream!!
    }

    fun publish(subject: String, data: String) {
        val js = ensureConnected()
        val ack = js.publish(subject, data.toByteArray(Charsets.UTF_8))
        log.debugf("Published to %s, stream=%s, seq=%d", subject, ack.stream, ack.seqno)
    }

    @PreDestroy
    fun close() {
        try {
            connection?.close()
            log.info("NATS connection closed")
        } catch (e: Exception) {
            log.warnf("Error closing NATS connection: %s", e.message)
        }
    }
}
