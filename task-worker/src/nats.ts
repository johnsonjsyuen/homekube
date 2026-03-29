import {
  connect,
  DiscardPolicy,
  RetentionPolicy,
  StorageType,
  type NatsConnection,
  type JetStreamClient,
} from "nats";

let nc: NatsConnection | null = null;
let js: JetStreamClient | null = null;

const STREAM_NAME = "TASK_RESULTS";
const SUBJECT_PREFIX = "task.results";

export async function connectNats(url: string): Promise<NatsConnection> {
  nc = await connect({ servers: url });
  console.log(`Connected to NATS at ${url}`);
  return nc;
}

export async function ensureResultStream(): Promise<void> {
  if (!nc) throw new Error("NATS not connected");

  const jsm = await nc.jetstreamManager();

  try {
    await jsm.streams.info(STREAM_NAME);
    console.log(`Stream ${STREAM_NAME} already exists`);
  } catch {
    await jsm.streams.add({
      name: STREAM_NAME,
      subjects: [`${SUBJECT_PREFIX}.>`],
      storage: StorageType.File,
      retention: RetentionPolicy.Limits,
      max_msgs: 10_000,
      max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanos
      discard: DiscardPolicy.Old,
    });
    console.log(`Created stream ${STREAM_NAME}`);
  }

  js = nc.jetstream();
}

export async function publishResult(taskId: string, payload: string): Promise<void> {
  if (!js) throw new Error("JetStream not initialized — call ensureResultStream first");
  const subject = `${SUBJECT_PREFIX}.${taskId}`;
  await js.publish(subject, new TextEncoder().encode(payload));
}

export async function disconnectNats(): Promise<void> {
  if (nc) {
    await nc.drain();
    nc = null;
    js = null;
  }
}
