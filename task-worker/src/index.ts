import { hostname } from "os";
import { connectNats } from "./nats.js";
import { startPoller } from "./poller.js";

const workerId = process.env.WORKER_ID;
if (!workerId) {
  console.error("WORKER_ID environment variable is required");
  process.exit(1);
}

// Comma-separated list of capabilities, e.g. "gpu,windows,media"
const capabilities = (process.env.WORKER_CAPABILITIES ?? "")
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean);

const { nc, js, codec } = await connectNats();

// Publish worker_online event
await js.publish(
  "project1.events",
  codec.encode({
    worker: workerId,
    type: "worker_online",
    timestamp: new Date().toISOString(),
    capabilities,
    platform: process.platform,
    hostname: hostname(),
  }),
);
console.log(`Worker "${workerId}" online, capabilities: [${capabilities.join(", ")}]`);

// Start the pull consumer loop
startPoller(nc, js, workerId, capabilities).catch((err) => {
  console.error("Poller crashed:", err);
  process.exit(1);
});

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down...");
  await nc.drain();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
