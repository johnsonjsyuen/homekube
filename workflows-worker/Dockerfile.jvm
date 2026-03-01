# Stage 1: Build (fast-jar packaging -- Quarkus default)
FROM gradle:8.12-jdk21 AS builder
WORKDIR /app
COPY build.gradle.kts settings.gradle.kts gradle.properties ./
COPY src/ src/
RUN gradle build --no-daemon -x test

# Stage 2: Runtime
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /app/build/quarkus-app/ ./
EXPOSE 3000
CMD ["java", "-jar", "quarkus-run.jar"]
