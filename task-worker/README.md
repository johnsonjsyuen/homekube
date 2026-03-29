# Task Worker

Temporal-based worker that executes Claude Code tasks on remote machines. Workers poll a Temporal task queue, run `claude --dangerously-skip-permissions`, and publish results to NATS JetStream.

## Prerequisites

- [Bun](https://bun.sh) runtime
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Network access to Temporal server and NATS server

## Install

```bash
git clone <repo-url>
cd task-worker
bun install
```

## Run the worker

```bash
TEMPORAL_ADDRESS=temporal-frontend.temporal:7233 \
NATS_URL=nats://nats.nats:4222 \
TASK_QUEUE=worker.myhost \
bun run start
```

### Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TEMPORAL_ADDRESS` | No | `localhost:7233` | Temporal frontend gRPC address |
| `TEMPORAL_NAMESPACE` | No | `default` | Temporal namespace |
| `NATS_URL` | No | `nats://localhost:4222` | NATS server URL |
| `TASK_QUEUE` | No | `worker.default` | Task queue name (convention: `worker.<machine-name>`) |
| `WORK_DIR` | No | current directory | Default working directory for Claude Code |

## Submit a task

### CLI

```bash
TEMPORAL_ADDRESS=localhost:7233 \
bun run submit worker.myhost "List all files in this repo" /path/to/repo
```

### Programmatic (TypeScript)

```typescript
import { TaskSubmitter } from "./src/client.js";

const submitter = await TaskSubmitter.connect("temporal-frontend.temporal:7233");

const workflowId = await submitter.submit("worker.windows", {
  taskId: crypto.randomUUID(),
  prompt: "Refactor the auth module",
  workDir: "/home/user/myrepo",
});

// Block until the worker finishes
const result = await submitter.waitForResult(workflowId);
console.log(result.status, result.output);

await submitter.close();
```

Resubmitting the same `taskId` is idempotent — it returns the existing workflow.

## Architecture

```
Submitter → Temporal Server → Worker (polls task queue)
                                 ├── runs claude CLI
                                 └── publishes result → NATS (task.results.<taskId>)
```

- Each machine runs one worker with its own task queue name
- Workers execute one task at a time
- Failed tasks are retried up to 3x by Temporal
- Results are stored in Temporal (queryable) and published to NATS for fanout
