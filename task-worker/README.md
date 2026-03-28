# task-worker

NATS JetStream pull consumer that executes tasks via Claude Code CLI. Runs on worker machines (not in k8s).

## How it works

1. Pulls tasks from the `task-workers` durable consumer on the `PROJECT1` JetStream stream
2. Filters by `target` (worker ID) and `required_capabilities`
3. Invokes `claude --dangerously-skip-permissions -p "<instruction>"`
4. Acks on success, nacks on failure (NATS redelivers up to 3x)
5. Publishes `task_started`/`task_completed`/`task_failed` events to `project1.events`

## Prerequisites

- [Bun](https://bun.sh) installed
- Claude Code CLI installed and authenticated (`claude login`)
- Network access to NATS at `192.168.8.209:4222`

## Setup

```bash
bun install
```

## Running

```bash
WORKER_ID=windows1 WORKER_CAPABILITIES=gpu,windows,media bun run src/index.ts
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WORKER_ID` | yes | — | Unique worker identifier (e.g. `windows1`) |
| `WORKER_CAPABILITIES` | no | — | Comma-separated capabilities (e.g. `gpu,windows,media`) |
| `NATS_URL` | no | `nats://192.168.8.209:4222` | NATS server URL |

## Capabilities

Workers declare capabilities on startup. Tasks can require capabilities via `required_capabilities`. A worker only accepts a task if it has **all** required capabilities.

Example capabilities: `gpu`, `windows`, `unix`, `media`

## Task format

Published to `project1.tasks`:

```json
{
  "task_id": "uuid",
  "target": "windows1",
  "required_capabilities": ["gpu", "media"],
  "instruction": "do something",
  "type": "command"
}
```

## Pairing with /dispatch skill

The orchestrator uses the `/dispatch` Claude Code skill (in `~/.claude/skills/dispatch/`) to enqueue tasks and wait for results.
