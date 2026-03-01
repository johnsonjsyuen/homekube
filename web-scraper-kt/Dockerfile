# Stage 1: Build native image using Mandrel (GraalVM for Quarkus)
FROM quay.io/quarkus/ubi-quarkus-mandrel-builder-image:jdk-21 AS builder
USER root

# Install Gradle (Mandrel image does not include it)
RUN microdnf install -y findutils unzip && microdnf clean all
ARG GRADLE_VERSION=8.12
RUN curl -sL https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip -o /tmp/gradle.zip \
    && unzip /tmp/gradle.zip -d /opt \
    && rm /tmp/gradle.zip
ENV PATH="/opt/gradle-${GRADLE_VERSION}/bin:${PATH}"

WORKDIR /app
COPY build.gradle.kts settings.gradle.kts gradle.properties ./
COPY src/ src/

RUN gradle build -Dquarkus.native.enabled=true -Dquarkus.package.jar.enabled=false --no-daemon -x test

# Stage 2: Minimal runtime
FROM quay.io/quarkus/quarkus-micro-image:2.0
WORKDIR /app
COPY --from=builder /app/build/*-runner /app/application
EXPOSE 3000
CMD ["./application", "-Dquarkus.http.host=0.0.0.0"]
