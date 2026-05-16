package com.homekube.location

import jakarta.enterprise.context.ApplicationScoped
import jakarta.enterprise.inject.Produces
import jakarta.inject.Inject
import org.jooq.DSLContext
import org.jooq.SQLDialect
import org.jooq.impl.DSL
import javax.sql.DataSource

@ApplicationScoped
class JooqConfig {

    @Inject
    lateinit var dataSource: DataSource

    @Produces
    @ApplicationScoped
    fun dslContext(): DSLContext = DSL.using(dataSource, SQLDialect.POSTGRES)
}
