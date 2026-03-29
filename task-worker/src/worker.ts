import { hostname } from "os";
import { NativeConnection, Worker, bundleWorkflowCode } from "@temporalio/worker";
import { connectNats, ensureResultStream, disconnectNats } from "./nats.js";
import { setWorkerId } from "./activities.js";
import * as activities from "./activities.js";

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const TASK_QUEUE = process.env.TASK_QUEUE ?? "worker.default";
const WORK_DIR = process.env.WORK_DIR ?? process.cwd();
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "default";

const workerId = `${hostname()}-${process.pid}`;
setWorkerId(workerId);

console.log(`Starting worker "${workerId}" on queue "${TASK_QUEUE}"`);
console.log(`  Temporal: ${TEMPORAL_ADDRESS} (namespace: ${TEMPORAL_NAMESPACE})`);
console.log(`  NATS: ${NATS_URL}`);
console.log(`  Work dir: ${WORK_DIR}`);

// Connect to NATS
await connectNats(NATS_URL);
await ensureResultStream();

// Connect to Temporal
const temporalConnection = await NativeConnection.connect({
  address: TEMPORAL_ADDRESS,
});

const workflowBundle = await bundleWorkflowCode({
  workflowsPath: new URL("./workflows.ts", import.meta.url).pathname,
});

const worker = await Worker.create({
  connection: temporalConnection,
  namespace: TEMPORAL_NAMESPACE,
  workflowBundle,
  activities,
  taskQueue: TASK_QUEUE,
  maxConcurrentActivityTaskExecutions: 1,
  maxConcurrentWorkflowTaskExecutions: 1,
  identity: workerId,
});

console.log(`Worker "${workerId}" polling task queue "${TASK_QUEUE}"`);

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down worker...");
  worker.shutdown();
  // Worker.run() will resolve once shutdown is complete
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

try {
  await worker.run();
  console.log("Worker stopped gracefully");
} finally {
  await disconnectNats();
  await temporalConnection.close();
}
