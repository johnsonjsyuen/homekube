# NATS Task Orchestration (Implementation)

## 1. Overview

Two components that formalise the ad-hoc NATS task coordination into a durable system:

1. **`task-worker`** — A Bun + TypeScript process running on each worker machine (e.g. windows1). It:
   - Pulls tasks from a JetStream durable consumer on `project1.tasks`
   - Invokes `claude --dangerously-skip-permissions -p "<instruction>"` to execute the task
   - **Acks** the NATS message on success (exit code 0)
   - **Nacks** the NATS message on failure (non-zero exit, allows redelivery up to 3x)
   - Publishes results to `project1.events`

2. **`/dispatch` Claude Code skill** — A slash command run on the orchestrator Claude Code instance that:
   - Publishes a task to `project1.tasks` via JetStream
   - Subscribes to `project1.events` and waits for the matching `task_completed` response
   - Displays the result to the user

**No Temporal.** NATS JetStream provides everything needed: exactly-once delivery, ack/nack retries (max-deliver=3), timeout via ack_wait, and a persistent audit trail. Claude Code invocations are atomic (run to completion or fail) — there's no mid-task state to checkpoint.

---

## 2. Architecture

```
┌─────────────────────┐    js.publish()     ┌──────────────────────┐
│  Orchestrator       │ ──────────────────► │  NATS JetStream      │
│  Claude Code +      │                     │  PROJECT1 stream     │
│  /dispatch skill    │                     │  project1.tasks subj │
└─────────┬───────────┘                     └──────────┬───────────┘
          │                                            │
          │  subscribe (core NATS)                     │ pull consumer
          │  project1.events                           │ "task-workers"
          │  filter by task_id                         │ ack=explicit
          │                                            ▼
          │                                 ┌──────────────────────┐
          │                                 │  task-worker         │
          │                                 │  (Bun + TS)          │
          │                                 │  on windows1 etc.    │
          │                                 │                      │
          │                                 │  1. Pull task msg    │
          │                                 │  2. Publish          │
          │                                 │     task_started     │
          │                                 │  3. Bun.spawn:       │
          │                                 │     claude -p "..."  │
          │                                 │  4. Exit 0 → ack     │
          │                                 │     Exit !0 → nack   │
          │                                 │  5. Publish result   │
          │                                 │     → project1.events│
          │                                 └──────────┬───────────┘
          │                                            │
          │                                            │ publish
          │                                            ▼
          │                                 ┌──────────────────────┐
          └────────────────────────────────│  NATS JetStream      │
                                            │  project1.events     │
                                            └──────────────────────┘
```

---

## 3. NATS Infrastructure Changes

### 3.1 New Durable Consumer

Add to `nats/k8s/init-streams.yaml`:

```bash
nats -s nats://nats:4222 consumer add PROJECT1 task-workers \
  --pull --ack=explicit --wait=10m --max-deliver=3 \
  --deliver=all --replay=instant --filter="project1.tasks" --defaults
```

| Setting | Value | Rationale |
|---------|-------|-----------|
| Consumer name | `task-workers` | Shared across all worker instances |
| Filter | `project1.tasks` | Only task messages, not events |
| Ack policy | explicit | Worker acks after Claude Code succeeds, nacks on failure |
| Max deliver | 3 | Dead-letter after 3 failed attempts |
| Ack wait | 10m | Claude Code tasks can take minutes; must exceed longest expected task |

### 3.2 Subject Conventions

| Subject | Direction | Purpose |
|---------|-----------|---------|
| `project1.tasks` | Orchestrator → Stream → Workers | Task enqueue, pulled by workers |
| `project1.events` | Workers → Stream → Orchestrator | Results, status updates, worker_online |

Workers pull from a shared consumer — NATS delivers each task to exactly one worker. If that worker nacks, NATS redelivers to any available worker.

---

## 4. Message Schema

### 4.1 Task (project1.tasks)

```typescript
interface Task {
  task_id: string;        // UUID v4
  target?: string;        // optional worker_id hint (e.g. "windows1")
  instruction: string;    // natural language instruction for Claude Code
  type: "command";        // extensible, currently only "command"
}
```

`target` is advisory — a worker skips tasks not addressed to it (nacks for redelivery). With a single worker, all tasks are consumed.

### 4.2 Task Result (project1.events)

```typescript
interface TaskResult {
  worker: string;         // worker_id that executed the task
  type: "task_started" | "task_completed" | "task_failed";
  task_id: string;
  timestamp: string;      // ISO 8601
  status?: "success" | "error";
  result?: string;        // Claude Code stdout (the task output)
  error?: string;         // error message if status=error
}
```

### 4.3 Worker Online (project1.events)

```typescript
interface WorkerOnline {
  worker: string;
  type: "worker_online";
  timestamp: string;
  capabilities: string[];
  platform: string;
  hostname: string;
}
```

---

## 5. Component 1: task-worker

### 5.1 Project Structure

```
task-worker/
├── src/
│   ├── index.ts         # Entrypoint: connect NATS, publish worker_online, start pull loop
│   ├── poller.ts        # Pull consumer loop: pull → route → execute → ack/nack → publish
│   ├── executor.ts      # Spawn claude CLI subprocess, capture output
│   └── nats.ts          # NATS client setup (connect, jetstream, codec)
├── package.json
├── tsconfig.json
└── README.md
```

No Dockerfile, no k8s manifests — runs directly on worker machines.

### 5.2 Entrypoint (index.ts)

```typescript
// Config from env:
//   NATS_URL     default: nats://192.168.8.209:4222
//   WORKER_ID    required, e.g. "windows1"

// 1. Connect to NATS
// 2. Publish worker_online event to project1.events
// 3. Start pull loop (poller.ts)
// 4. On SIGTERM/SIGINT: drain NATS connection, exit
```

### 5.3 Poller (poller.ts)

```
Loop:
  1. Pull 1 message from consumer "task-workers" on stream "PROJECT1"
     (blocks until message available)
  2. Parse message as Task
  3. On malformed JSON:
     - msg.ack() — discard garbage, don't redeliver
     - Log error
     - Continue
  4. If task.target is set AND task.target !== WORKER_ID:
     - msg.nak() — redeliver to another worker
     - Continue
  5. Publish task_started event to project1.events:
     { worker, type: "task_started", task_id, timestamp }
  6. Call executor.run(task.instruction)
  7. On success (exit code 0):
     - msg.ack()
     - Publish task_completed event:
       { worker, type: "task_completed", task_id, status: "success", result: stdout, timestamp }
  8. On failure (non-zero exit):
     - msg.nak() — NATS will redeliver (up to max-deliver=3)
     - Publish task_failed event:
       { worker, type: "task_failed", task_id, status: "error", error: stderr, timestamp }
```

### 5.4 Executor (executor.ts)

```typescript
// Input: instruction: string
// Action:
//   Bun.spawn(["claude", "--dangerously-skip-permissions", "-p", instruction])
//
//   Auth: Uses API key already on the machine (claude login, done once).
//   --dangerously-skip-permissions: required for unattended execution.
//
//   Captures stdout (task result) and stderr (diagnostics).
//   Enforces a 10-minute process timeout via Bun.spawn timeout option.
//
// Output: { stdout: string, stderr: string, exitCode: number }
// Throws: if process times out (killed with SIGTERM)
```

### 5.5 Dependencies

```json
{
  "dependencies": {
    "nats": "^2.28.0"
  }
}
```

Single dependency. No Temporal, no native binary deps.

### 5.6 Running on Worker Machines

```bash
# On windows1 (PowerShell with Bun, or WSL)
export NATS_URL=nats://192.168.8.209:4222
export WORKER_ID=windows1
bun run src/index.ts
```

Workers need:
- Network access to NATS LB (192.168.8.209:4222)
- Bun installed
- Claude Code CLI installed and authenticated (`claude login` — done once per machine)

---

## 6. Component 2: /dispatch Claude Code Skill

### 6.1 Skill Location

```
~/.claude/skills/dispatch/
├── dispatch.md       # Skill definition
└── dispatch.ts       # Bun script
```

### 6.2 Skill Definition (dispatch.md)

The skill instructs Claude to:
1. Parse the user's request into a target worker and instruction
2. Run `dispatch.ts` via Bash tool with the appropriate args
3. Display the result

```markdown
---
name: dispatch
description: Dispatch a task to a remote worker via NATS and wait for the result
---

When the user wants to send a task to a remote worker, use this skill.

Parse the user's request to identify:
- `target`: which worker to send to (e.g. "windows1")
- `instruction`: what the worker should do

Then run:

  bun run ~/.claude/skills/dispatch/dispatch.ts \
    --target "<target>" \
    --instruction "<instruction>" \
    [--timeout <seconds>]

The script will:
1. Publish the task to NATS JetStream (project1.tasks)
2. Wait for the worker's response on project1.events
3. Print the result JSON to stdout

Display the result to the user. If the script exits non-zero, report the error.
```

### 6.3 Dispatch Script (dispatch.ts)

```
Script: dispatch.ts
  Args: --target <worker_id> --instruction <text> [--timeout <seconds>]
  Env: NATS_URL (default: nats://192.168.8.209:4222)

  1. Parse args (Bun.argv)
  2. Validate --target and --instruction are present, else print usage and exit 1
  3. Generate task_id = crypto.randomUUID()
  4. Connect to NATS
  5. Get JetStream context
  6. Subscribe to "project1.events" on core NATS (before publishing, to avoid race)
  7. Publish task to "project1.tasks" via js.publish():
     { task_id, target, instruction, type: "command" }
  8. For each message on project1.events:
     - Parse JSON
     - If task_id matches AND type is "task_completed" or "task_failed":
       print JSON to stdout, drain, exit 0
  9. On timeout (default 300s):
     - Print { error: "timeout", task_id } to stderr, exit 1
  10. Drain NATS connection
```

| Config | Default | Override |
|--------|---------|----------|
| NATS_URL | `nats://192.168.8.209:4222` | env var |
| Timeout | 300s | `--timeout` arg |

---

## 7. Anti-Patterns (DO NOT)

| # | Don't | Do Instead | Why |
|---|-------|------------|-----|
| 1 | Ack before Claude Code finishes | Ack only after exit code 0 | Acking early loses the task on failure |
| 2 | Nack on malformed JSON | Ack malformed messages | Nacking garbage causes infinite redelivery |
| 3 | Create one consumer per worker | Share single `task-workers` consumer | NATS pull consumers load-balance across subscribers |
| 4 | Hardcode NATS address | Use `NATS_URL` env var | Workers are on different networks |
| 5 | Use request/reply pattern | Use pub/sub with task_id correlation | Tasks are async, can take minutes |
| 6 | Add Temporal or other orchestrators | Keep it NATS-only | Claude Code calls are atomic; NATS ack/nack/redelivery is sufficient |
| 7 | Parse or validate the instruction | Pass through opaquely to Claude | Worker routes and executes, doesn't interpret |
| 8 | Retry within the worker process | Let NATS max-deliver handle retries | Single retry mechanism, avoids complexity |

---

## 8. Test Case Specifications

### Unit Tests

| Test ID | Component | Input | Expected Output | Edge Cases |
|---------|-----------|-------|-----------------|------------|
| UT-001 | poller | Valid task, matching target | Executes, acks, publishes task_completed | |
| UT-002 | poller | Valid task, wrong target | Nacks immediately | target=undefined → accept |
| UT-003 | poller | Malformed JSON | Acks (discard), logs error | Empty body |
| UT-004 | poller | Claude exits non-zero | Nacks, publishes task_failed | |
| UT-005 | executor | Simple instruction | Spawns claude, returns stdout | |
| UT-006 | executor | Instruction causes timeout | Process killed, throws | |
| UT-007 | dispatch.ts | Valid args | Publishes task, receives result, exits 0 | |
| UT-008 | dispatch.ts | No response within timeout | Exits 1 | |
| UT-009 | dispatch.ts | Missing --target | Prints usage, exits 1 | |

### Integration Tests

| Test ID | Flow | Setup | Verification | Teardown |
|---------|------|-------|--------------|----------|
| IT-001 | Happy path | Start task-worker, dispatch simple instruction | dispatch.ts prints result, task_completed in stream | Stop worker |
| IT-002 | Failure + redelivery | Dispatch instruction that fails, second attempt succeeds | First nacked, second acked, task_completed published | |
| IT-003 | Target filtering | Two workers (A, B), task targets B | A nacks, B executes and acks | |
| IT-004 | Max deliver exhausted | Dispatch always-failing instruction | 3 task_failed events, message dead-lettered | |

---

## 9. Error Handling Matrix

| Error Type | Detection | Response | Fallback | Logging |
|------------|-----------|----------|----------|---------|
| NATS connection down (worker) | nats.js error event | Auto-reconnect (built-in backoff) | Process exits if unrecoverable; restart via systemd/supervisor | ERROR |
| Claude Code exits non-zero | exitCode !== 0 | Nack message → NATS redelivers | Max 3 redeliveries, then dead-letter | WARN |
| Claude Code process timeout | Bun.spawn timeout fires | Kill process, nack message | Redelivery | WARN |
| Malformed task JSON | JSON.parse throws | Ack message (discard) | Log raw bytes | ERROR |
| Worker crash mid-task | NATS ack_wait (10m) expires | NATS redelivers to any worker | Up to max-deliver attempts | — |
| NATS connection down (skill) | connect() throws | Print error, exit 1 | User re-runs /dispatch | stderr |
| No workers online | Skill timeout expires | Print timeout error, exit 1 | User checks worker status | stderr |

---

## 10. References

| Topic | Location |
|-------|----------|
| NATS JetStream stream config | `nats/k8s/init-streams.yaml` |
| NATS k8s deployment | `nats/k8s/` |
| PROJECT1 stream definition | Created with `project1.>` subjects, Limits retention, 720h max age |
| NATS JS migration spec | `docs/nats-jetstream-migration-spec.md` |
| nats.js library | https://github.com/nats-io/nats.js |
| Bun docs | https://bun.sh/docs |
