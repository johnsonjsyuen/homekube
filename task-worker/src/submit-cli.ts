import { TaskSubmitter } from "./client.js";
import type { TaskInput } from "./types.js";

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "default";

const taskQueue = process.argv[2];
const prompt = process.argv[3];

if (!taskQueue || !prompt) {
  console.error("Usage: bun run submit <task-queue> <prompt> [work-dir]");
  console.error("  e.g: bun run submit worker.windows 'List all files in this repo'");
  process.exit(1);
}

const workDir = process.argv[4] ?? process.cwd();
const taskId = crypto.randomUUID();

const input: TaskInput = {
  taskId,
  prompt,
  workDir,
};

const submitter = await TaskSubmitter.connect(TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE);
const workflowId = await submitter.submit(taskQueue, input);

console.log(`Submitted task ${taskId}`);
console.log(`  Workflow ID: ${workflowId}`);
console.log(`  Task queue:  ${taskQueue}`);
console.log(`  Prompt:      ${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}`);
console.log(`\nWaiting for result...`);

const result = await submitter.waitForResult(workflowId);
console.log(`\nResult:`);
console.log(`  Status:   ${result.status}`);
console.log(`  Duration: ${result.durationMs}ms`);
console.log(`  Worker:   ${result.workerId}`);
if (result.output) console.log(`  Output:\n${result.output}`);
if (result.error) console.error(`  Error:\n${result.error}`);

await submitter.close();
